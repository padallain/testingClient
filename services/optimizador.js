const { solveDispatchAssignment } = require('./dispatchAssignmentSolver');

const PRIORITY_ZONE_ORDER = ['NORTE', 'OESTE', 'SUR', 'CENTRO'];
const PRIORITY_ZONE_SET = new Set(PRIORITY_ZONE_ORDER);
const PRIORITY_ZONE_WEIGHTS = { NORTE: 4, OESTE: 3, SUR: 2, CENTRO: 1 };
const DEFAULT_EXTERNAL_COST = 170;
const EXTERNAL_RATIO_LIMIT = 0.02;
// Zonas "dedicadas": nunca comparten vehículo con ninguna otra zona (van
// siempre solas). Esto es independiente de qué tipo de vehículo pueden
// usar — ver VAN_RESTRICTED_ZONES para esa restricción.
const DEDICATED_ZONES = new Set(['MACHIQUES', 'PUERTOS', 'CONCEPCIÓN', 'MARA']);
// Zonas que no pueden usar camioneta (deben ir en camión o externo). MARA
// y MACHIQUES además son dedicadas (DEDICATED_ZONES); PUERTOS y
// CONCEPCIÓN son dedicadas pero SÍ pueden usar camioneta (se prioriza
// camioneta para ellas en empates económicos, vía el desempate normal
// camioneta < camión del solver).
const VAN_RESTRICTED_ZONES = new Set(['MENEGRANDE', 'MACHIQUES', 'MARA']);
const KNOWN_ZONE_NAMES = new Map([
  ['SUR', 'SUR'],
  ['CENTRO', 'CENTRO'],
  ['OESTE', 'OESTE'],
  ['NORTE', 'NORTE'],
  ['OJEDA', 'OJEDA'],
  ['MENEGRANDE', 'MENEGRANDE'],
  ['CABIMAS', 'CABIMAS'],
  ['BACHAQUERO', 'BACHAQUERO'],
  ['MACHIQUES', 'MACHIQUES'],
  ['PUERTOS', 'PUERTOS'],
  ['CONCEPCION', 'CONCEPCIÓN'],
  ['CONCEPCIÓN', 'CONCEPCIÓN'],
  ['MARA', 'MARA'],
]);

const DEFAULT_FLEET = {
  camionetas: Array.from({ length: 3 }, (_, index) => ({
    id: index + 1,
    codigo: `CAMIONETA_${index + 1}`,
    nombre: `Camioneta ${index + 1}`,
    capacidadKg: 950,
    capacidadClientes: 40,
    disponible: true,
  })),
  camiones: Array.from({ length: 3 }, (_, index) => ({
    id: index + 1,
    codigo: `CAMION_${index + 1}`,
    nombre: `Camión ${index + 1}`,
    capacidadKg: 5000,
    capacidadClientes: 30,
    disponible: true,
  })),
};

function stripAccents(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function normalizeZoneName(value) {
  const normalized = stripAccents(value).trim().toUpperCase();
  return KNOWN_ZONE_NAMES.get(normalized) || normalized;
}

function toPositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function sum(values) {
  return values.reduce((total, current) => total + (Number(current) || 0), 0);
}

function normalizeZones(zonas) {
  if (!Array.isArray(zonas)) {
    return [];
  }

  const deduped = new Map();

  for (const zone of zonas) {
    const nombre = normalizeZoneName(zone?.nombre);

    if (!nombre) {
      continue;
    }

    const current = deduped.get(nombre) || {
      nombre,
      clientes: 0,
      cajas: 0,
      valor_dolares: 0,
      kg: 0,
      dificil_acceso: false,
      ruta_larga: false,
    };

    current.clientes += toPositiveNumber(zone?.clientes);
    current.cajas += toPositiveNumber(zone?.cajas);
    current.valor_dolares += toPositiveNumber(zone?.valor_dolares ?? zone?.valor);
    current.kg += toPositiveNumber(zone?.kg ?? zone?.peso);
    current.dificil_acceso = current.dificil_acceso || Boolean(zone?.dificil_acceso);
    current.ruta_larga = current.ruta_larga || Boolean(zone?.ruta_larga);
    deduped.set(nombre, current);
  }

  return [...deduped.values()].filter((zone) => zone.kg > 0 || zone.valor_dolares > 0 || zone.clientes > 0 || zone.cajas > 0);
}

function normalizeVehicleList(rawList, defaults) {
  if (!Array.isArray(rawList) || rawList.length === 0) {
    return defaults.map((vehicle) => ({ ...vehicle }));
  }

  const byId = new Map(rawList.map((vehicle) => [Number(vehicle?.id), Boolean(vehicle?.disponible)]));

  return defaults.map((vehicle) => ({
    ...vehicle,
    disponible: byId.has(vehicle.id) ? byId.get(vehicle.id) : true,
  }));
}

function buildVehicleAvailability(vehiculos) {
  const camionetas = normalizeVehicleList(vehiculos?.camionetas, DEFAULT_FLEET.camionetas);
  const camiones = normalizeVehicleList(vehiculos?.camiones, DEFAULT_FLEET.camiones);

  return {
    camionetas,
    camiones,
    camionetasDisponibles: camionetas.filter((vehicle) => vehicle.disponible),
    camionesDisponibles: camiones.filter((vehicle) => vehicle.disponible),
  };
}

function buildZoneMap(zonas) {
  return new Map(zonas.map((zone) => [zone.nombre, zone]));
}

function buildUnit(zoneNames, zoneMap) {
  const sourceZones = zoneNames.map((zoneName) => zoneMap.get(zoneName)).filter(Boolean);

  return {
    zonas: sourceZones.map((zone) => zone.nombre),
    kg_total: sum(sourceZones.map((zone) => zone.kg)),
    valor_total_dolares: sum(sourceZones.map((zone) => zone.valor_dolares)),
    clientes_total: sum(sourceZones.map((zone) => zone.clientes)),
    cajas_total: sum(sourceZones.map((zone) => zone.cajas)),
    prioridad_peso: sum(sourceZones.map((zone) => PRIORITY_ZONE_WEIGHTS[zone.nombre] || 0)),
    dificil_acceso: sourceZones.some((zone) => zone.dificil_acceso),
    ruta_larga: sourceZones.some((zone) => zone.ruta_larga),
  };
}

function isPriorityOnlyUnit(unit) {
  return unit.zonas.every((zone) => PRIORITY_ZONE_SET.has(zone));
}

function isPrioritySingleUnit(unit) {
  return unit.zonas.length === 1 && isPriorityOnlyUnit(unit);
}

function buildPlanItem(unit, vehicle, tipo, motivo) {
  return {
    vehiculo: vehicle.codigo,
    nombre_vehiculo: vehicle.nombre,
    tipo,
    zonas: [...unit.zonas],
    kg_total: unit.kg_total,
    capacidad_kg: vehicle.capacidadKg,
    porcentaje_ocupacion: round((unit.kg_total / vehicle.capacidadKg) * 100, 2),
    valor_total_dolares: unit.valor_total_dolares,
    clientes_total: unit.clientes_total,
    cajas_total: unit.cajas_total,
    motivo,
  };
}

function getExternalCostRatio(unit, externalCost) {
  if (!unit.valor_total_dolares) {
    return Number.POSITIVE_INFINITY;
  }

  return externalCost / unit.valor_total_dolares;
}

function buildExternalItem(unit, externalCost) {
  const ratio = getExternalCostRatio(unit, externalCost);
  const meetsRatioThreshold = ratio < EXTERNAL_RATIO_LIMIT;

  return {
    zona: unit.zonas.join(' + '),
    zonas: [...unit.zonas],
    valor_dolares: unit.valor_total_dolares,
    kg_total: unit.kg_total,
    clientes_total: unit.clientes_total,
    cajas_total: unit.cajas_total,
    razon: meetsRatioThreshold ? 'REQUIERE_EXTERNO' : 'EXTERNO_ULTIMO_RECURSO',
    costo_externo: externalCost,
    indicador_flete_porcentaje: Number.isFinite(ratio) ? round(ratio * 100, 2) : null,
    cumple_indicador_rentabilidad: meetsRatioThreshold,
    es_ultimo_recurso: !meetsRatioThreshold,
    ganancia_neta_si_externo: round(unit.valor_total_dolares - externalCost, 2),
  };
}

function buildTomorrowItem(unit) {
  return {
    zona: unit.zonas.join(' + '),
    zonas: [...unit.zonas],
    valor_dolares: unit.valor_total_dolares,
    kg_total: unit.kg_total,
    clientes_total: unit.clientes_total,
    cajas_total: unit.cajas_total,
    razon: 'PENDIENTE_MAÑANA',
  };
}

function buildAssignmentReason(unit, tipo) {
  if (tipo === 'camioneta') {
    if (unit.zonas.some((zone) => DEDICATED_ZONES.has(zone))) {
      return 'Camioneta priorizada para zona dedicada (PUERTOS/CONCEPCIÓN) cuando está disponible.';
    }
    return isPrioritySingleUnit(unit)
      ? 'Camioneta priorizada para zona crítica y atención rápida.'
      : 'Camioneta asignada por tamaño de carga y accesibilidad.';
  }

  if (unit.zonas.some((zone) => DEDICATED_ZONES.has(zone))) {
    return 'Zona dedicada: viaja sola, sin combinar con otras zonas.';
  }

  if (unit.zonas.some((zone) => VAN_RESTRICTED_ZONES.has(zone))) {
    return 'La combinación contiene zonas no aptas para camioneta.';
  }

  if (tipo === 'camion' && unit.zonas.length === 2 && unit.zonas.includes('NORTE') && unit.zonas.includes('SUR')) {
    return 'Camión usado como última consolidación para NORTE + SUR cuando conviene preservar camionetas en otras rutas.';
  }

  if (tipo === 'camion' && unit.zonas.length > 1 && isPriorityOnlyUnit(unit)) {
    return 'Camión usado para consolidar zonas prioritarias sin perder cobertura.';
  }

  return 'Camión asignado por capacidad o conveniencia operativa.';
}

function sortPlan(plan) {
  return [...plan].sort((left, right) => left.vehiculo.localeCompare(right.vehiculo, 'es'));
}

function buildRecommendations(plan, zonasExterno, zonasManana) {
  const coveredPriority = PRIORITY_ZONE_ORDER.filter((zoneName) => [...plan, ...zonasExterno].some((item) => item.zonas.includes(zoneName)));
  const notes = [];

  if (coveredPriority.length) {
    notes.push(`Las primeras zonas protegidas por el modelo fueron: ${coveredPriority.join(', ')}.`);
  }

  const vanAssignments = plan.filter((item) => item.tipo === 'camioneta').flatMap((item) => item.zonas);
  if (vanAssignments.length) {
    notes.push(`Camionetas asignadas a: ${vanAssignments.join(', ')}.`);
  }

  const groupedTrucks = plan.filter((item) => item.tipo === 'camion' && item.zonas.length > 1).map((item) => item.zonas.join(' + '));
  if (groupedTrucks.length) {
    notes.push(`Consolidaciones en camión: ${groupedTrucks.join('; ')}.`);
  }

  if (zonasExterno.length) {
    notes.push(`Se recomienda externo para: ${zonasExterno.map((item) => item.zona).join('; ')}.`);
  }

  const lastResortExternal = zonasExterno.filter((item) => item.es_ultimo_recurso);
  if (lastResortExternal.length) {
    notes.push(`Externo como último recurso en: ${lastResortExternal.map((item) => `${item.zona} (${item.indicador_flete_porcentaje}% de flete)`).join('; ')}.`);
  }

  if (zonasManana.length) {
    notes.push(`Queda para mañana: ${zonasManana.map((item) => item.zona).join('; ')}.`);
  }

  return notes;
}

/**
 * Convierte la salida del branch & bound (grupos de zonas por vehículo +
 * lista de zonas pospuestas) al formato de reporte del optimizador. Cada
 * grupo del mismo tipo se reparte a un vehículo físico distinto de la
 * flota disponible (son intercambiables entre sí, así que el orden no
 * importa).
 */
function buildDispatchFromAssignment(assignment, zoneMap, fleet, externalCost) {
  const plan = [];
  const zonasExterno = [];
  const zonasManana = [];

  const camionetasQueue = [...fleet.camionetasDisponibles];
  const camionesQueue = [...fleet.camionesDisponibles];

  for (const group of assignment.groups) {
    const unit = buildUnit(group.zonas, zoneMap);

    if (group.tipo === 'camioneta') {
      const vehicle = camionetasQueue.shift();
      plan.push(buildPlanItem(unit, vehicle, 'camioneta', buildAssignmentReason(unit, 'camioneta')));
    } else if (group.tipo === 'camion') {
      const vehicle = camionesQueue.shift();
      plan.push(buildPlanItem(unit, vehicle, 'camion', buildAssignmentReason(unit, 'camion')));
    } else {
      zonasExterno.push(buildExternalItem(unit, externalCost));
    }
  }

  for (const zoneName of assignment.deferred) {
    zonasManana.push(buildTomorrowItem(buildUnit([zoneName], zoneMap)));
  }

  return { plan, zonasExterno, zonasManana };
}

function buildStructuredResult({ plan, zonasExterno, zonasManana }, zoneMap, fleet, externalCost, diagnostics) {
  const sortedPlan = sortPlan(plan);
  const valorDespachadoHoy = sum(sortedPlan.map((item) => item.valor_total_dolares)) + sum(zonasExterno.map((item) => item.valor_dolares));
  const valorPendiente = sum(zonasManana.map((item) => item.valor_dolares));
  const clientesDespachados = sum(sortedPlan.map((item) => item.clientes_total)) + sum(zonasExterno.map((item) => item.clientes_total));
  const clientesPendientes = sum(zonasManana.map((item) => item.clientes_total));
  const totalVehiclesAvailable = fleet.camionetasDisponibles.length + fleet.camionesDisponibles.length;

  return {
    fecha: new Date(),
    zonas_input: [...zoneMap.values()],
    costo_externo_referencia: externalCost,
    plan: sortedPlan,
    zonas_externo: zonasExterno,
    zonas_mañana: zonasManana,
    recomendaciones: buildRecommendations(sortedPlan, zonasExterno, zonasManana),
    estrategia: {
      criterio: 'Optimización combinatoria exacta (branch & bound con poda por cotas admisibles): primero minimizar zonas críticas (NORTE/OESTE/SUR/CENTRO) pospuestas, luego maximizar el valor neto despachado hoy en dólares reales, y por último preferir vehículos propios sobre externo en empates económicos.',
      combinaciones_evaluadas: diagnostics.nodesExplored,
      zonas_atendidas_hoy: [...sortedPlan, ...zonasExterno].flatMap((item) => item.zonas),
      prioridad_pospuesta: diagnostics.pendingPriority,
      valor_neto_optimo: diagnostics.netValue,
      busqueda_completa: !diagnostics.aborted,
    },
    resumen: {
      valor_despachado_hoy: round(valorDespachadoHoy, 2),
      valor_pendiente: round(valorPendiente, 2),
      vehiculos_usados: sortedPlan.length,
      vehiculos_libres: Math.max(totalVehiclesAvailable - sortedPlan.length, 0),
      necesita_externo: zonasExterno.length > 0,
      porcentaje_flota_usada: totalVehiclesAvailable > 0 ? round((sortedPlan.length / totalVehiclesAvailable) * 100, 1) : 0,
      camionetas_usadas: sortedPlan.filter((item) => item.tipo === 'camioneta').length,
      camiones_usados: sortedPlan.filter((item) => item.tipo === 'camion').length,
      camionetas_habilitadas: fleet.camionetasDisponibles.length,
      camiones_habilitados: fleet.camionesDisponibles.length,
      camionetas_configuradas: fleet.camionetas.length,
      camiones_configurados: fleet.camiones.length,
      clientes_despachados: clientesDespachados,
      clientes_pendientes: clientesPendientes,
    },
    disponibilidad_vehiculos: {
      camionetas: fleet.camionetas,
      camiones: fleet.camiones,
    },
  };
}

function capacityOf(vehicle, fallback) {
  return vehicle ? { kg: vehicle.capacidadKg, clientes: vehicle.capacidadClientes } : fallback;
}

function calculateOptimalDispatch({ zonas, costoExternoReferencia, costo_externo_referencia, vehiculos } = {}) {
  const normalizedZones = normalizeZones(zonas);

  if (!normalizedZones.length) {
    const error = new Error('No hay zonas válidas para calcular');
    error.statusCode = 400;
    throw error;
  }

  const requestedExternalCost = Number(costoExternoReferencia ?? costo_externo_referencia);
  const externalCost = requestedExternalCost > 0 ? requestedExternalCost : DEFAULT_EXTERNAL_COST;
  const zoneMap = buildZoneMap(normalizedZones);
  const fleet = buildVehicleAvailability(vehiculos);

  const camionetaCapacity = capacityOf(fleet.camionetasDisponibles[0], capacityOf(DEFAULT_FLEET.camionetas[0]));
  const camionCapacity = capacityOf(fleet.camionesDisponibles[0], capacityOf(DEFAULT_FLEET.camiones[0]));

  const assignment = solveDispatchAssignment({
    zones: normalizedZones,
    camionetaCapacity,
    camionCapacity,
    camionetasCount: fleet.camionetasDisponibles.length,
    camionesCount: fleet.camionesDisponibles.length,
    externalCost,
    priorityWeights: new Map(Object.entries(PRIORITY_ZONE_WEIGHTS)),
    dedicatedZones: DEDICATED_ZONES,
    vanRestrictedZones: VAN_RESTRICTED_ZONES,
  });

  const { plan, zonasExterno, zonasManana } = buildDispatchFromAssignment(assignment, zoneMap, fleet, externalCost);

  return buildStructuredResult({ plan, zonasExterno, zonasManana }, zoneMap, fleet, externalCost, assignment.diagnostics);
}

module.exports = {
  PRIORITY_ZONE_ORDER,
  calculateOptimalDispatch,
  normalizeZones,
  buildVehicleAvailability,
};

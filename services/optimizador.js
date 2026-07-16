const { solveDispatchAssignment, buildIncompatibilitySet } = require('./dispatchAssignmentSolver');

const DEFAULT_EXTERNAL_COST = 170;
const EXTERNAL_RATIO_LIMIT = 0.02;

/**
 * Reglas de zona por defecto (Maracaibo). Solo se usan cuando la petición
 * NO manda `configZonas` — si lo manda, esas reglas se ignoran por
 * completo y se usan únicamente las que llegaron en el request (ver
 * `resolveZoneConfig`). Así, otra ciudad puede usar este mismo backend
 * mandando su propia configuración sin tocar código ni redeploy.
 */
const MARACAIBO_PRIORITY_WEIGHTS = { NORTE: 4, OESTE: 3, SUR: 2, CENTRO: 1 };
const MARACAIBO_DEDICATED_ZONES = ['MACHIQUES', 'PUERTOS', 'CONCEPCIÓN', 'MARA'];
const MARACAIBO_VAN_RESTRICTED_ZONES = ['MENEGRANDE', 'MACHIQUES', 'MARA'];
// OJEDA solo puede compartir vehículo con estas tres zonas; se marca
// incompatible con cualquier otra zona presente en la petición.
const MARACAIBO_OJEDA_ALLOWED_PARTNERS = ['CABIMAS', 'MENEGRANDE', 'BACHAQUERO'];
// Simplificación pareada de la regla histórica "CENTRO+OESTE solo vale si
// además va NORTE o SUR": con el modelo genérico de pares incompatibles
// no se puede expresar esa condicionalidad, así que CENTRO y OESTE quedan
// incompatibles entre sí siempre (deja de ser posible NORTE+CENTRO+OESTE
// o SUR+CENTRO+OESTE en un mismo vehículo).
const MARACAIBO_FIXED_INCOMPATIBLE_PAIRS = [['CENTRO', 'OESTE']];

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

// Solo trim + mayúsculas: normaliza espacios y capitalización sin perder
// tildes/ñ ni asumir ningún nombre de zona en particular (toUpperCase ya
// resuelve "concepción" === "CONCEPCIÓN" sin necesidad de sacar acentos).
function normalizeZoneName(value) {
  return String(value || '').trim().toUpperCase();
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

  const byId = new Map(rawList.map((vehicle) => [Number(vehicle?.id), vehicle]));

  return defaults.map((vehicle) => {
    const override = byId.get(vehicle.id);
    if (!override) {
      return { ...vehicle, disponible: true };
    }

    return {
      ...vehicle,
      disponible: override.disponible !== undefined ? Boolean(override.disponible) : true,
      capacidadKg: toPositiveNumber(override.capacidadKg) || vehicle.capacidadKg,
      capacidadClientes: toPositiveNumber(override.capacidadClientes) || vehicle.capacidadClientes,
    };
  });
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
    dificil_acceso: sourceZones.some((zone) => zone.dificil_acceso),
    ruta_larga: sourceZones.some((zone) => zone.ruta_larga),
  };
}

function isPriorityOnlyUnit(unit, zoneConfig) {
  return unit.zonas.length > 0 && unit.zonas.every((zone) => zoneConfig.priorityWeights.has(zone));
}

function isPrioritySingleUnit(unit, zoneConfig) {
  return unit.zonas.length === 1 && isPriorityOnlyUnit(unit, zoneConfig);
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

function buildAssignmentReason(unit, tipo, zoneConfig) {
  const isDedicated = unit.zonas.some((zone) => zoneConfig.dedicatedZones.has(zone));

  if (tipo === 'camioneta') {
    if (isDedicated) {
      return 'Camioneta priorizada para zona dedicada disponible.';
    }
    return isPrioritySingleUnit(unit, zoneConfig)
      ? 'Camioneta priorizada para zona crítica y atención rápida.'
      : 'Camioneta asignada por tamaño de carga y accesibilidad.';
  }

  if (isDedicated) {
    return 'Zona dedicada: viaja sola, sin combinar con otras zonas.';
  }

  if (unit.zonas.some((zone) => zoneConfig.vanRestrictedZones.has(zone))) {
    return 'La combinación contiene zonas no aptas para camioneta.';
  }

  if (tipo === 'camion' && unit.zonas.length > 1 && isPriorityOnlyUnit(unit, zoneConfig)) {
    return 'Camión usado para consolidar zonas prioritarias sin perder cobertura.';
  }

  return 'Camión asignado por capacidad o conveniencia operativa.';
}

function sortPlan(plan) {
  return [...plan].sort((left, right) => left.vehiculo.localeCompare(right.vehiculo, 'es'));
}

function buildRecommendations(plan, zonasExterno, zonasManana, zoneConfig) {
  const coveredPriority = zoneConfig.priorityZoneNames.filter((zoneName) => [...plan, ...zonasExterno].some((item) => item.zonas.includes(zoneName)));
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
function buildDispatchFromAssignment(assignment, zoneMap, fleet, externalCost, zoneConfig) {
  const plan = [];
  const zonasExterno = [];
  const zonasManana = [];

  const camionetasQueue = [...fleet.camionetasDisponibles];
  const camionesQueue = [...fleet.camionesDisponibles];

  for (const group of assignment.groups) {
    const unit = buildUnit(group.zonas, zoneMap);

    if (group.tipo === 'camioneta') {
      const vehicle = camionetasQueue.shift();
      plan.push(buildPlanItem(unit, vehicle, 'camioneta', buildAssignmentReason(unit, 'camioneta', zoneConfig)));
    } else if (group.tipo === 'camion') {
      const vehicle = camionesQueue.shift();
      plan.push(buildPlanItem(unit, vehicle, 'camion', buildAssignmentReason(unit, 'camion', zoneConfig)));
    } else {
      zonasExterno.push(buildExternalItem(unit, externalCost));
    }
  }

  for (const zoneName of assignment.deferred) {
    zonasManana.push(buildTomorrowItem(buildUnit([zoneName], zoneMap)));
  }

  return { plan, zonasExterno, zonasManana };
}

function buildStructuredResult({ plan, zonasExterno, zonasManana }, zoneMap, fleet, externalCost, diagnostics, zoneConfig) {
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
    recomendaciones: buildRecommendations(sortedPlan, zonasExterno, zonasManana, zoneConfig),
    estrategia: {
      criterio: `Optimización combinatoria exacta (branch & bound con poda por cotas admisibles): primero minimizar zonas prioritarias${zoneConfig.priorityZoneNames.length ? ` (${zoneConfig.priorityZoneNames.join('/')})` : ''} pospuestas, luego maximizar el valor neto despachado hoy en dólares reales, y por último preferir vehículos propios sobre externo en empates económicos.`,
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

/**
 * Config de zonas por defecto (Maracaibo), calculada contra las zonas
 * realmente presentes en esta petición (para que la exclusión de OJEDA se
 * exprese como pares concretos, no como una lista fija de nombres).
 */
function buildDefaultZoneConfig(zoneNames) {
  const priorityWeights = new Map(Object.entries(MARACAIBO_PRIORITY_WEIGHTS));
  const dedicatedZones = new Set(MARACAIBO_DEDICATED_ZONES);
  const vanRestrictedZones = new Set(MARACAIBO_VAN_RESTRICTED_ZONES);

  const ojedaAllowed = new Set(MARACAIBO_OJEDA_ALLOWED_PARTNERS);
  const pairs = [...MARACAIBO_FIXED_INCOMPATIBLE_PAIRS];
  for (const name of zoneNames) {
    if (name !== 'OJEDA' && !ojedaAllowed.has(name)) {
      pairs.push(['OJEDA', name]);
    }
  }

  return {
    priorityWeights,
    priorityZoneNames: Object.keys(MARACAIBO_PRIORITY_WEIGHTS),
    dedicatedZones,
    vanRestrictedZones,
    incompatiblePairs: buildIncompatibilitySet(pairs),
  };
}

/**
 * Config de zonas a partir de lo que mandó el caller en `configZonas`. Si
 * la petición trae este campo, se usa ÚNICAMENTE lo que llegó ahí — los
 * sub-campos omitidos quedan sin restricción (no heredan las reglas de
 * Maracaibo), para que otra ciudad pueda mandar su propia config completa
 * sin arrastrar reglas ajenas.
 */
function buildZoneConfigFromInput(configZonas) {
  const priorityWeights = new Map();
  for (const entry of configZonas.prioritarias || []) {
    const nombre = normalizeZoneName(entry?.nombre);
    const peso = Number(entry?.peso);
    if (nombre && Number.isFinite(peso) && peso > 0) {
      priorityWeights.set(nombre, peso);
    }
  }

  const dedicatedZones = new Set((configZonas.dedicadas || []).map(normalizeZoneName).filter(Boolean));
  const vanRestrictedZones = new Set((configZonas.sinCamioneta || []).map(normalizeZoneName).filter(Boolean));
  const incompatiblePairs = buildIncompatibilitySet(
    (configZonas.incompatibles || [])
      .filter((pair) => Array.isArray(pair) && pair.length === 2)
      .map(([a, b]) => [normalizeZoneName(a), normalizeZoneName(b)]),
  );

  return {
    priorityWeights,
    priorityZoneNames: [...priorityWeights.keys()],
    dedicatedZones,
    vanRestrictedZones,
    incompatiblePairs,
  };
}

function resolveZoneConfig(configZonas, zoneNames) {
  if (configZonas && typeof configZonas === 'object') {
    return buildZoneConfigFromInput(configZonas);
  }

  return buildDefaultZoneConfig(zoneNames);
}

function calculateOptimalDispatch({ zonas, costoExternoReferencia, costo_externo_referencia, vehiculos, configZonas } = {}) {
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
  const zoneConfig = resolveZoneConfig(configZonas, normalizedZones.map((zone) => zone.nombre));

  const camionetaCapacity = capacityOf(fleet.camionetasDisponibles[0], capacityOf(DEFAULT_FLEET.camionetas[0]));
  const camionCapacity = capacityOf(fleet.camionesDisponibles[0], capacityOf(DEFAULT_FLEET.camiones[0]));

  const assignment = solveDispatchAssignment({
    zones: normalizedZones,
    camionetaCapacity,
    camionCapacity,
    camionetasCount: fleet.camionetasDisponibles.length,
    camionesCount: fleet.camionesDisponibles.length,
    externalCost,
    priorityWeights: zoneConfig.priorityWeights,
    dedicatedZones: zoneConfig.dedicatedZones,
    vanRestrictedZones: zoneConfig.vanRestrictedZones,
    incompatiblePairs: zoneConfig.incompatiblePairs,
  });

  const { plan, zonasExterno, zonasManana } = buildDispatchFromAssignment(assignment, zoneMap, fleet, externalCost, zoneConfig);

  return buildStructuredResult({ plan, zonasExterno, zonasManana }, zoneMap, fleet, externalCost, assignment.diagnostics, zoneConfig);
}

module.exports = {
  calculateOptimalDispatch,
  normalizeZones,
  buildVehicleAvailability,
};

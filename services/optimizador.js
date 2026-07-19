const { solveDispatchAssignment, buildIncompatibilitySet } = require('./dispatchAssignmentSolver');
const {
  PRIORITY_WEIGHTS: MARACAIBO_PRIORITY_WEIGHTS,
  DEDICATED_ZONES: MARACAIBO_DEDICATED_ZONES,
  VAN_RESTRICTED_ZONES: MARACAIBO_VAN_RESTRICTED_ZONES,
  OJEDA_ALLOWED_PARTNERS: MARACAIBO_OJEDA_ALLOWED_PARTNERS,
  FIXED_INCOMPATIBLE_PAIRS: MARACAIBO_FIXED_INCOMPATIBLE_PAIRS,
} = require('./dispatchTerritoryConfig');

const DEFAULT_EXTERNAL_COST = 170;
const EXTERNAL_RATIO_LIMIT = 0.02;

/**
 * Reglas de zona por defecto (Maracaibo). Solo se usan cuando la petición
 * NO manda `configZonas` — si lo manda, esas reglas se ignoran por
 * completo y se usan únicamente las que llegaron en el request (ver
 * `resolveZoneConfig`). Así, otra ciudad puede usar este mismo backend
 * mandando su propia configuración sin tocar código ni redeploy.
 */
const DEFAULT_FLEET = {
  unidades: [
    {
      id: 1,
      codigo: 'VEHICULO_1',
      nombre: 'Vehículo 1',
      capacidadKg: 950,
      capacidadClientes: 40,
      disponible: true,
      zonasPermitidas: [],
    },
    {
      id: 2,
      codigo: 'VEHICULO_2',
      nombre: 'Vehículo 2',
      capacidadKg: 950,
      capacidadClientes: 40,
      disponible: true,
      zonasPermitidas: [],
    },
    {
      id: 3,
      codigo: 'VEHICULO_3',
      nombre: 'Vehículo 3',
      capacidadKg: 5000,
      capacidadClientes: 30,
      disponible: true,
      zonasPermitidas: [],
    },
  ],
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
    const zoneId = String(zone?.id || nombre || '').trim();

    if (!nombre) {
      continue;
    }

    const current = deduped.get(nombre) || {
      id: zoneId || nombre,
      nombre,
      clientes: 0,
      cajas: 0,
      valor_facturado_dolares: 0,
      valor_dolares: 0,
      porcentaje_utilidad: toPositiveNumber(zone?.porcentaje_utilidad),
      kg: 0,
      dificil_acceso: false,
      ruta_larga: false,
    };

    current.clientes += toPositiveNumber(zone?.clientes);
    current.cajas += toPositiveNumber(zone?.cajas);
    current.valor_facturado_dolares += toPositiveNumber(zone?.valor_facturado_dolares ?? zone?.valor_facturado ?? zone?.valor);
    current.valor_dolares += toPositiveNumber(zone?.valor_dolares ?? zone?.valor);
    current.porcentaje_utilidad = current.porcentaje_utilidad || toPositiveNumber(zone?.porcentaje_utilidad);
    current.kg += toPositiveNumber(zone?.kg ?? zone?.peso);
    current.dificil_acceso = current.dificil_acceso || Boolean(zone?.dificil_acceso);
    current.ruta_larga = current.ruta_larga || Boolean(zone?.ruta_larga);
    deduped.set(nombre, current);
  }

  return [...deduped.values()].filter((zone) => zone.kg > 0 || zone.valor_dolares > 0 || zone.clientes > 0 || zone.cajas > 0);
}

function normalizeVehicleList(rawList, defaults, useDefaultsWhenEmpty = true) {
  if (!Array.isArray(rawList)) {
    return useDefaultsWhenEmpty ? defaults.map((vehicle) => ({ ...vehicle })) : [];
  }

  if (rawList.length === 0) {
    return [];
  }

  return rawList
    .map((vehicle, index) => {
      const fallback = defaults[index] || defaults[0] || {};
      const numericIndex = index + 1;

      return {
        id: vehicle?.id ?? fallback.id ?? numericIndex,
        codigo: String(vehicle?.codigo || fallback.codigo || `VEHICULO_${numericIndex}`),
        nombre: String(vehicle?.nombre || fallback.nombre || `Vehículo ${numericIndex}`),
        disponible: vehicle?.disponible !== undefined ? Boolean(vehicle.disponible) : true,
        capacidadKg: toPositiveNumber(vehicle?.capacidadKg),
        capacidadClientes: toPositiveNumber(vehicle?.capacidadClientes),
        zonasPermitidas: Array.isArray(vehicle?.zonasPermitidas)
          ? [...new Set(vehicle.zonasPermitidas.map(normalizeZoneName).filter(Boolean))]
          : [],
      };
    })
    .filter((vehicle) => vehicle.capacidadKg > 0 && vehicle.capacidadClientes > 0);
}

function flattenFleetInput(vehiculos) {
  if (Array.isArray(vehiculos?.unidades)) {
    return vehiculos.unidades;
  }

  return [...(Array.isArray(vehiculos?.camionetas) ? vehiculos.camionetas : []), ...(Array.isArray(vehiculos?.camiones) ? vehiculos.camiones : [])];
}

function buildVehicleAvailability(vehiculos) {
  const hasExplicitFleet = Boolean(vehiculos && typeof vehiculos === 'object');
  const unidades = normalizeVehicleList(flattenFleetInput(vehiculos), DEFAULT_FLEET.unidades, !hasExplicitFleet);

  return {
    unidades,
    unidadesDisponibles: unidades.filter((vehicle) => vehicle.disponible),
  };
}

function buildZoneMap(zonas) {
  return new Map(zonas.map((zone) => [zone.nombre, zone]));
}

function buildUnit(zoneNames, zoneMap) {
  const sourceZones = zoneNames.map((zoneName) => zoneMap.get(zoneName)).filter(Boolean);

  return {
    zonas: sourceZones.map((zone) => zone.nombre),
    zonas_ids: sourceZones.map((zone) => zone.id),
    kg_total: sum(sourceZones.map((zone) => zone.kg)),
    valor_facturado_total_dolares: sum(sourceZones.map((zone) => zone.valor_facturado_dolares)),
    valor_total_dolares: sum(sourceZones.map((zone) => zone.valor_dolares)),
    porcentaje_utilidad_referencia: sourceZones.find((zone) => Number(zone.porcentaje_utilidad) > 0)?.porcentaje_utilidad || 0,
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
    zonas_ids: [...unit.zonas_ids],
    kg_total: unit.kg_total,
    capacidad_kg: vehicle.capacidadKg,
    porcentaje_ocupacion: round((unit.kg_total / vehicle.capacidadKg) * 100, 2),
    valor_facturado_total_dolares: unit.valor_facturado_total_dolares,
    valor_total_dolares: unit.valor_total_dolares,
    porcentaje_utilidad_referencia: unit.porcentaje_utilidad_referencia,
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
    zonas_ids: [...unit.zonas_ids],
    valor_facturado_dolares: unit.valor_facturado_total_dolares,
    valor_dolares: unit.valor_total_dolares,
    kg_total: unit.kg_total,
    clientes_total: unit.clientes_total,
    cajas_total: unit.cajas_total,
    porcentaje_utilidad_referencia: unit.porcentaje_utilidad_referencia,
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
    zonas_ids: [...unit.zonas_ids],
    valor_facturado_dolares: unit.valor_facturado_total_dolares,
    valor_dolares: unit.valor_total_dolares,
    kg_total: unit.kg_total,
    clientes_total: unit.clientes_total,
    cajas_total: unit.cajas_total,
    porcentaje_utilidad_referencia: unit.porcentaje_utilidad_referencia,
    razon: 'PENDIENTE_MAÑANA',
  };
}

function buildAssignmentReason(unit, tipo, zoneConfig) {
  const isDedicated = unit.zonas.some((zone) => zoneConfig.dedicatedZones.has(zone));

  if (isDedicated) {
    return 'Zona dedicada: viaja sola, sin combinar con otras zonas.';
  }

  if (tipo === 'propio' && unit.zonas.length > 1 && isPriorityOnlyUnit(unit, zoneConfig)) {
    return 'Vehículo propio usado para consolidar zonas prioritarias sin perder cobertura.';
  }

  return isPrioritySingleUnit(unit, zoneConfig)
    ? 'Vehículo propio priorizado para zona crítica y atención rápida.'
    : 'Vehículo propio asignado por capacidad y restricciones configuradas.';
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

  const ownAssignments = plan.filter((item) => item.tipo === 'propio').map((item) => `${item.nombre_vehiculo}: ${item.zonas.join(' + ')}`);
  if (ownAssignments.length) {
    notes.push(`Vehículos propios asignados a: ${ownAssignments.join('; ')}.`);
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
 * cada grupo propio se reparte al vehículo físico que abrió ese grupo.
 */
function buildDispatchFromAssignment(assignment, zoneMap, fleet, externalCost, zoneConfig) {
  const plan = [];
  const zonasExterno = [];
  const zonasManana = [];

  const vehicleMap = new Map(fleet.unidadesDisponibles.map((vehicle) => [String(vehicle.id), vehicle]));

  for (const group of assignment.groups) {
    const unit = buildUnit(group.zonas, zoneMap);

    if (group.tipo === 'propio') {
      const vehicle = vehicleMap.get(String(group.vehicleId));
      if (vehicle) {
        plan.push(buildPlanItem(unit, vehicle, 'propio', buildAssignmentReason(unit, 'propio', zoneConfig)));
      }
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
  const facturadoDespachadoHoy = sum(sortedPlan.map((item) => item.valor_facturado_total_dolares)) + sum(zonasExterno.map((item) => item.valor_facturado_dolares));
  const valorDespachadoHoy = sum(sortedPlan.map((item) => item.valor_total_dolares)) + sum(zonasExterno.map((item) => item.valor_dolares));
  const facturadoPendiente = sum(zonasManana.map((item) => item.valor_facturado_dolares));
  const valorPendiente = sum(zonasManana.map((item) => item.valor_dolares));
  const clientesDespachados = sum(sortedPlan.map((item) => item.clientes_total)) + sum(zonasExterno.map((item) => item.clientes_total));
  const clientesPendientes = sum(zonasManana.map((item) => item.clientes_total));
  const totalVehiclesAvailable = fleet.unidadesDisponibles.length;
  const porcentajeUtilidadReferencia = [...zoneMap.values()].find((zone) => Number(zone.porcentaje_utilidad) > 0)?.porcentaje_utilidad || 0;

  return {
    fecha: new Date(),
    zonas_input: [...zoneMap.values()],
    costo_externo_referencia: externalCost,
    porcentaje_utilidad_referencia: porcentajeUtilidadReferencia,
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
      facturado_despachado_hoy: round(facturadoDespachadoHoy, 2),
      valor_despachado_hoy: round(valorDespachadoHoy, 2),
      facturado_pendiente: round(facturadoPendiente, 2),
      valor_pendiente: round(valorPendiente, 2),
      vehiculos_usados: sortedPlan.length,
      vehiculos_libres: Math.max(totalVehiclesAvailable - sortedPlan.length, 0),
      necesita_externo: zonasExterno.length > 0,
      porcentaje_flota_usada: totalVehiclesAvailable > 0 ? round((sortedPlan.length / totalVehiclesAvailable) * 100, 1) : 0,
      vehiculos_propios_usados: sortedPlan.filter((item) => item.tipo === 'propio').length,
      vehiculos_propios_habilitados: fleet.unidadesDisponibles.length,
      vehiculos_propios_configurados: fleet.unidades.length,
      clientes_despachados: clientesDespachados,
      clientes_pendientes: clientesPendientes,
    },
    disponibilidad_vehiculos: {
      unidades: fleet.unidades,
    },
  };
}

/**
 * Config de zonas por defecto (Maracaibo), calculada contra las zonas
 * realmente presentes en esta petición (para que la exclusión de OJEDA se
 * exprese como pares concretos, no como una lista fija de nombres).
 */
function buildDefaultZoneConfig(zoneNames) {
  const priorityWeights = new Map(Object.entries(MARACAIBO_PRIORITY_WEIGHTS));
  const dedicatedZones = new Set(MARACAIBO_DEDICATED_ZONES);

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
  const incompatiblePairs = buildIncompatibilitySet(
    (configZonas.incompatibles || [])
      .filter((pair) => Array.isArray(pair) && pair.length === 2)
      .map(([a, b]) => [normalizeZoneName(a), normalizeZoneName(b)]),
  );

  return {
    priorityWeights,
    priorityZoneNames: [...priorityWeights.keys()],
    dedicatedZones,
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

  const assignment = solveDispatchAssignment({
    zones: normalizedZones,
    vehicles: fleet.unidadesDisponibles,
    externalCost,
    priorityWeights: zoneConfig.priorityWeights,
    dedicatedZones: zoneConfig.dedicatedZones,
    incompatiblePairs: zoneConfig.incompatiblePairs,
  });

  const { plan, zonasExterno, zonasManana } = buildDispatchFromAssignment(assignment, zoneMap, fleet, externalCost, zoneConfig);

  return buildStructuredResult({ plan, zonasExterno, zonasManana }, zoneMap, fleet, externalCost, assignment.diagnostics, zoneConfig);
}

module.exports = {
  DEFAULT_FLEET,
  calculateOptimalDispatch,
  normalizeZones,
  buildVehicleAvailability,
};

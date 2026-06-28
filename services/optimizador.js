const PRIORITY_ZONE_ORDER = ['NORTE', 'OESTE', 'SUR', 'CENTRO'];
const PRIORITY_ZONE_SET = new Set(PRIORITY_ZONE_ORDER);
const PRIORITY_ZONE_WEIGHTS = { NORTE: 4, OESTE: 3, SUR: 2, CENTRO: 1 };
const SOLO_TRUCK_ZONES = new Set(['MACHIQUES', 'PUERTOS', 'CONCEPCIÓN', 'MARA']);
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
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
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

function isValidPriorityGroup(group) {
  if (group.length === 1) {
    return true;
  }

  const set = new Set(group);
  const hasNorth = set.has('NORTE');
  const hasSouth = set.has('SUR');
  const hasCentro = set.has('CENTRO');
  const hasOeste = set.has('OESTE');

  if (group.length === 2) {
    return (
      (hasNorth && hasCentro) ||
      (hasNorth && hasOeste) ||
      (hasSouth && hasCentro) ||
      (hasSouth && hasOeste)
    );
  }

  if (group.length === 3) {
    return hasCentro && hasOeste && (hasNorth !== hasSouth);
  }

  return false;
}

function buildPriorityPartitions(zoneMap) {
  const activePriorityZones = PRIORITY_ZONE_ORDER.filter((zoneName) => zoneMap.has(zoneName));

  if (!activePriorityZones.length) {
    return [[]];
  }

  const partitions = [];
  const seen = new Set();

  function explore(remaining, groups) {
    if (!remaining.length) {
      const signature = groups.map((group) => [...group].sort().join('+')).sort().join('|');
      if (!seen.has(signature)) {
        seen.add(signature);
        partitions.push(groups.map((group) => [...group]));
      }
      return;
    }

    const [first, ...rest] = remaining;
    const candidates = [[first]];

    for (const zoneName of rest) {
      const pair = [first, zoneName];
      if (isValidPriorityGroup(pair)) {
        candidates.push(pair);
      }
    }

    if (rest.includes('CENTRO') && rest.includes('OESTE')) {
      const triple = [first, 'CENTRO', 'OESTE'];
      if (isValidPriorityGroup(triple)) {
        candidates.push(triple);
      }
    }

    for (const candidate of candidates) {
      const used = new Set(candidate);
      const nextRemaining = rest.filter((zoneName) => !used.has(zoneName));
      explore(nextRemaining, [...groups, candidate]);
    }
  }

  explore(activePriorityZones, []);
  return partitions;
}

function buildOjedaOptions(zoneMap) {
  if (!zoneMap.has('OJEDA')) {
    const singles = [];
    if (zoneMap.has('MENEGRANDE')) singles.push(['MENEGRANDE']);
    if (zoneMap.has('BACHAQUERO')) singles.push(['BACHAQUERO']);
    if (zoneMap.has('CABIMAS')) singles.push(['CABIMAS']);
    return [singles];
  }

  const options = [];
  const baseGroup = ['OJEDA'];

  if (zoneMap.has('MENEGRANDE')) {
    baseGroup.push('MENEGRANDE');
  }

  if (zoneMap.has('BACHAQUERO')) {
    baseGroup.push('BACHAQUERO');
  }

  options.push([baseGroup, ...(zoneMap.has('CABIMAS') ? [['CABIMAS']] : [])]);

  if (zoneMap.has('CABIMAS')) {
    options.push([[...baseGroup, 'CABIMAS']]);
  }

  return options;
}

function buildOtherSingles(zoneMap) {
  const reserved = new Set([...PRIORITY_ZONE_ORDER, 'OJEDA', 'MENEGRANDE', 'BACHAQUERO', 'CABIMAS', ...SOLO_TRUCK_ZONES]);
  const singles = [];

  for (const zoneName of zoneMap.keys()) {
    if (!reserved.has(zoneName)) {
      singles.push([zoneName]);
    }
  }

  return singles;
}

function buildPlanOptions(zoneMap) {
  const dedicatedSingles = [...SOLO_TRUCK_ZONES]
    .filter((zoneName) => zoneMap.has(zoneName))
    .map((zoneName) => [zoneName]);
  const priorityPartitions = buildPriorityPartitions(zoneMap);
  const ojedaOptions = buildOjedaOptions(zoneMap);
  const otherSingles = buildOtherSingles(zoneMap);
  const options = [];
  const seen = new Set();

  for (const priorityPartition of priorityPartitions) {
    for (const ojedaGroups of ojedaOptions) {
      const groups = [...priorityPartition, ...ojedaGroups, ...dedicatedSingles, ...otherSingles].filter((group) => group.length > 0);
      const signature = groups.map((group) => [...group].sort().join('+')).sort().join('|');

      if (!seen.has(signature)) {
        seen.add(signature);
        options.push(groups.map((group) => buildUnit(group, zoneMap)));
      }
    }
  }

  return options;
}

function canUseVan(unit) {
  if (unit.zonas.some((zone) => SOLO_TRUCK_ZONES.has(zone) || VAN_RESTRICTED_ZONES.has(zone))) {
    return false;
  }

  return unit.kg_total <= 950 && unit.clientes_total <= 40;
}

function canUseTruck(unit) {
  return unit.kg_total <= 5000 && unit.clientes_total <= 30;
}

function canUseExternal(unit) {
  return unit.kg_total <= 5000;
}

function compareUnits(left, right) {
  return (
    right.prioridad_peso - left.prioridad_peso ||
    Number(isPrioritySingleUnit(right)) - Number(isPrioritySingleUnit(left)) ||
    right.zonas.length - left.zonas.length ||
    right.valor_total_dolares - left.valor_total_dolares ||
    right.kg_total - left.kg_total ||
    right.clientes_total - left.clientes_total
  );
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

function buildExternalItem(unit, externalCost) {
  return {
    zona: unit.zonas.join(' + '),
    zonas: [...unit.zonas],
    valor_dolares: unit.valor_total_dolares,
    kg_total: unit.kg_total,
    clientes_total: unit.clientes_total,
    cajas_total: unit.cajas_total,
    razon: 'REQUIERE_EXTERNO',
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
    return isPrioritySingleUnit(unit)
      ? 'Camioneta priorizada para zona crítica y atención rápida.'
      : 'Camioneta asignada por tamaño de carga y accesibilidad.';
  }

  if (unit.zonas.some((zone) => SOLO_TRUCK_ZONES.has(zone))) {
    return 'Zona con restricción dura de camión dedicado.';
  }

  if (unit.zonas.some((zone) => VAN_RESTRICTED_ZONES.has(zone))) {
    return 'La combinación contiene zonas no aptas para camioneta.';
  }

  if (tipo === 'camion' && unit.zonas.length > 1 && isPriorityOnlyUnit(unit)) {
    return 'Camión usado para consolidar zonas prioritarias sin perder cobertura.';
  }

  return 'Camión asignado por capacidad o conveniencia operativa.';
}

function scoreDecisionSet(plan, zonasExterno, zonasManana) {
  const priorityServedWeight = sum([...plan, ...zonasExterno].map((item) => sum(item.zonas.map((zone) => PRIORITY_ZONE_WEIGHTS[zone] || 0))));
  const priorityPendingWeight = sum(zonasManana.map((item) => sum(item.zonas.map((zone) => PRIORITY_ZONE_WEIGHTS[zone] || 0))));
  const ownPriorityWeight = sum(plan.map((item) => sum(item.zonas.map((zone) => PRIORITY_ZONE_WEIGHTS[zone] || 0))));
  const totalServedZones = sum([...plan, ...zonasExterno].map((item) => item.zonas.length));
  const totalValueToday = sum(plan.map((item) => item.valor_total_dolares)) + sum(zonasExterno.map((item) => item.valor_dolares));
  const externalZoneCount = sum(zonasExterno.map((item) => item.zonas.length));
  const priorityVanWeight = sum(plan.filter((item) => item.tipo === 'camioneta').map((item) => sum(item.zonas.map((zone) => PRIORITY_ZONE_WEIGHTS[zone] || 0))));

  return (
    priorityServedWeight * 1e12 -
    priorityPendingWeight * 1e13 +
    ownPriorityWeight * 1e9 +
    totalServedZones * 1e7 +
    totalValueToday * 100 -
    externalZoneCount * 1000 +
    priorityVanWeight * 10
  );
}

function searchAssignments(units, fleet, externalCost) {
  const sortedUnits = [...units].sort(compareUnits);
  let best = { score: Number.NEGATIVE_INFINITY, plan: [], zonasExterno: [], zonasManana: [] };

  function recurse(index, availableVans, availableTrucks, plan, zonasExterno, zonasManana) {
    if (index >= sortedUnits.length) {
      const score = scoreDecisionSet(plan, zonasExterno, zonasManana);
      if (score > best.score) {
        best = {
          score,
          plan: plan.map((item) => ({ ...item, zonas: [...item.zonas] })),
          zonasExterno: zonasExterno.map((item) => ({ ...item, zonas: [...item.zonas] })),
          zonasManana: zonasManana.map((item) => ({ ...item, zonas: [...item.zonas] })),
        };
      }
      return;
    }

    const unit = sortedUnits[index];

    if (availableVans.length > 0 && canUseVan(unit)) {
      recurse(
        index + 1,
        availableVans.slice(1),
        availableTrucks,
        [...plan, buildPlanItem(unit, availableVans[0], 'camioneta', buildAssignmentReason(unit, 'camioneta'))],
        zonasExterno,
        zonasManana,
      );
    }

    if (availableTrucks.length > 0 && canUseTruck(unit)) {
      recurse(
        index + 1,
        availableVans,
        availableTrucks.slice(1),
        [...plan, buildPlanItem(unit, availableTrucks[0], 'camion', buildAssignmentReason(unit, 'camion'))],
        zonasExterno,
        zonasManana,
      );
    }

    if (canUseExternal(unit) && (externalCost <= 0 || unit.valor_total_dolares - externalCost > 0)) {
      recurse(
        index + 1,
        availableVans,
        availableTrucks,
        plan,
        [...zonasExterno, buildExternalItem(unit, externalCost)],
        zonasManana,
      );
    }

    recurse(
      index + 1,
      availableVans,
      availableTrucks,
      plan,
      zonasExterno,
      [...zonasManana, buildTomorrowItem(unit)],
    );
  }

  recurse(0, fleet.camionetasDisponibles, fleet.camionesDisponibles, [], [], []);
  return best;
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

  if (zonasManana.length) {
    notes.push(`Queda para mañana: ${zonasManana.map((item) => item.zona).join('; ')}.`);
  }

  return notes;
}

function buildStructuredResult(best, zoneMap, fleet, externalCost, combinationsCount) {
  const plan = sortPlan(best.plan);
  const zonas_externo = best.zonasExterno;
  const zonas_mañana = best.zonasManana;
  const valorDespachadoHoy = sum(plan.map((item) => item.valor_total_dolares)) + sum(zonas_externo.map((item) => item.valor_dolares));
  const valorPendiente = sum(zonas_mañana.map((item) => item.valor_dolares));
  const clientesDespachados = sum(plan.map((item) => item.clientes_total)) + sum(zonas_externo.map((item) => item.clientes_total));
  const clientesPendientes = sum(zonas_mañana.map((item) => item.clientes_total));
  const totalVehiclesAvailable = fleet.camionetasDisponibles.length + fleet.camionesDisponibles.length;

  return {
    fecha: new Date(),
    zonas_input: [...zoneMap.values()],
    costo_externo_referencia: externalCost,
    plan,
    zonas_externo,
    zonas_mañana,
    recomendaciones: buildRecommendations(plan, zonas_externo, zonas_mañana),
    estrategia: {
      criterio: 'Atender primero NORTE, OESTE, SUR y CENTRO; luego maximizar valor despachado respetando peso, clientes, vehículos y combinaciones válidas.',
      combinaciones_evaluadas: combinationsCount,
      zonas_atendidas_hoy: [...plan, ...zonas_externo].flatMap((item) => item.zonas),
    },
    resumen: {
      valor_despachado_hoy: round(valorDespachadoHoy, 2),
      valor_pendiente: round(valorPendiente, 2),
      vehiculos_usados: plan.length,
      vehiculos_libres: Math.max(totalVehiclesAvailable - plan.length, 0),
      necesita_externo: zonas_externo.length > 0,
      porcentaje_flota_usada: totalVehiclesAvailable > 0 ? round((plan.length / totalVehiclesAvailable) * 100, 1) : 0,
      camionetas_usadas: plan.filter((item) => item.tipo === 'camioneta').length,
      camiones_usados: plan.filter((item) => item.tipo === 'camion').length,
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

function calculateOptimalDispatch({ zonas, costoExternoReferencia, costo_externo_referencia, vehiculos } = {}) {
  const normalizedZones = normalizeZones(zonas);

  if (!normalizedZones.length) {
    const error = new Error('No hay zonas válidas para calcular');
    error.statusCode = 400;
    throw error;
  }

  const externalCost = Number(costoExternoReferencia ?? costo_externo_referencia) || 0;
  const zoneMap = buildZoneMap(normalizedZones);
  const fleet = buildVehicleAvailability(vehiculos);
  const planOptions = buildPlanOptions(zoneMap);
  let bestOverall = null;

  for (const units of planOptions) {
    const candidate = searchAssignments(units, fleet, externalCost);
    if (!bestOverall || candidate.score > bestOverall.score) {
      bestOverall = candidate;
    }
  }

  return buildStructuredResult(bestOverall, zoneMap, fleet, externalCost, planOptions.length);
}

module.exports = {
  PRIORITY_ZONE_ORDER,
  calculateOptimalDispatch,
  normalizeZones,
  buildVehicleAvailability,
};
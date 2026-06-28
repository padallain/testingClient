const path = require('path');

const ZONES_ALL = ['SUR', 'CENTRO', 'OESTE', 'NORTE', 'OJEDA', 'MENEGRANDE', 'CABIMAS', 'BACHAQUERO', 'MACHIQUES', 'PUERTOS', 'CONCEPCIÓN', 'MARA'];
const ZONES_SOLO_REQUIRED = new Set(['MACHIQUES', 'PUERTOS', 'CONCEPCIÓN', 'MARA']);
const VAN_COUNT = 3;
const VAN_CAP = 950;
const VAN_CLIENT_CAP = 40;
const TRUCK_COUNT = 3;
const TRUCK_CAP = 5000;
const TRUCK_CLIENT_CAP = 30;
const VAN_RESTRICTED_ZONES = new Set(['MENEGRANDE', 'MACHIQUES', 'MARA']);
const VAN_LABELS = Array.from({ length: VAN_COUNT }, (_, index) => `Camioneta ${index + 1}`);
const TRUCK_LABELS = Array.from({ length: TRUCK_COUNT }, (_, index) => `Camión ${index + 1}`);
const FLEX_PRIORITY_ZONES = ['NORTE', 'SUR', 'CENTRO', 'OESTE'];
const FLEX_ZONE_SET = new Set(FLEX_PRIORITY_ZONES);
const FLEX_ALLOWED_PARTNERS = {
  NORTE: ['CENTRO', 'OESTE'],
  SUR: ['CENTRO', 'OESTE'],
  CENTRO: ['NORTE', 'SUR'],
  OESTE: ['NORTE', 'SUR'],
};

function normalizeVehicleList(rawList, labels) {
  if (!Array.isArray(rawList) || rawList.length === 0) {
    return labels.map((label, index) => ({
      id: index + 1,
      nombre: label,
      disponible: true,
    }));
  }

  const byId = new Map(
    rawList.map((item) => [
      Number(item?.id),
      Boolean(item?.disponible),
    ]),
  );

  return labels.map((label, index) => ({
    id: index + 1,
    nombre: label,
    disponible: byId.has(index + 1) ? byId.get(index + 1) : true,
  }));
}

function buildVehicleAvailability(rawVehiculos) {
  const camionetas = normalizeVehicleList(rawVehiculos?.camionetas, VAN_LABELS);
  const camiones = normalizeVehicleList(rawVehiculos?.camiones, TRUCK_LABELS);

  return {
    camionetas,
    camiones,
    camionetasDisponibles: camionetas.filter((vehiculo) => vehiculo.disponible),
    camionesDisponibles: camiones.filter((vehiculo) => vehiculo.disponible),
  };
}

function buildUnit(zonas, active) {
  return zonas.reduce((unit, zone) => ({
    zonas: [...unit.zonas, zone],
    peso: unit.peso + (active[zone]?.peso || 0),
    valor: unit.valor + (active[zone]?.valor || 0),
    clientes: unit.clientes + (active[zone]?.clientes || 0),
  }), {
    zonas: [],
    peso: 0,
    valor: 0,
    clientes: 0,
  });
}

function canFitVan(unit) {
  const hasRestrictedZone = unit.zonas.some((zone) => VAN_RESTRICTED_ZONES.has(zone));

  return !hasRestrictedZone && unit.peso <= VAN_CAP && unit.clientes <= VAN_CLIENT_CAP;
}

function canFitTruck(unit) {
  return unit.peso <= TRUCK_CAP && unit.clientes <= TRUCK_CLIENT_CAP;
}

function canFitExternalTruck(unit) {
  return unit.peso <= TRUCK_CAP;
}

function isFlexOnlyUnit(unit) {
  return unit.zonas.every((zone) => FLEX_ZONE_SET.has(zone));
}

function isFlexSingleUnit(unit) {
  return unit.zonas.length === 1 && isFlexOnlyUnit(unit);
}

function unitSignature(unit) {
  return [...unit.zonas].sort().join('+');
}

function unitLabel(unit) {
  return unit.zonas.join(' + ');
}

function buildFixedDispatchUnits(active) {
  const units = [];

  for (const zone of ZONES_SOLO_REQUIRED) {
    if (active[zone]) {
      units.push(buildUnit([zone], active));
    }
  }

  if (active.CABIMAS) {
    units.push(buildUnit(['CABIMAS'], active));
  }

  if (active.OJEDA) {
    const ojedaGroup = ['OJEDA'];

    if (active.MENEGRANDE) {
      ojedaGroup.push('MENEGRANDE');
    }

    if (active.BACHAQUERO) {
      ojedaGroup.push('BACHAQUERO');
    }

    units.push(buildUnit(ojedaGroup, active));
  } else {
    if (active.MENEGRANDE) {
      units.push(buildUnit(['MENEGRANDE'], active));
    }

    if (active.BACHAQUERO) {
      units.push(buildUnit(['BACHAQUERO'], active));
    }
  }

  return units;
}

function buildFlexUnitOptions(active) {
  const flexActive = FLEX_PRIORITY_ZONES.filter((zone) => active[zone]);

  if (!flexActive.length) {
    return [[]];
  }

  const options = [];
  const seen = new Set();

  function explore(remaining, groups) {
    if (!remaining.length) {
      const units = groups.map((zonas) => buildUnit(zonas, active));
      const signature = units.map(unitSignature).sort().join('|');

      if (!seen.has(signature)) {
        seen.add(signature);
        options.push(units);
      }

      return;
    }

    const [first, ...rest] = remaining;

    explore(rest, [...groups, [first]]);

    for (const partner of rest) {
      if (!(FLEX_ALLOWED_PARTNERS[first] || []).includes(partner)) {
        continue;
      }

      const nextRemaining = rest.filter((zone) => zone !== partner);
      explore(nextRemaining, [...groups, [first, partner]]);
    }
  }

  explore(flexActive, []);

  return options;
}

function buildDispatchOptions(active) {
  const fixedUnits = buildFixedDispatchUnits(active);
  const flexOptions = buildFlexUnitOptions(active);

  return flexOptions.map((flexUnits) => [...fixedUnits, ...flexUnits]);
}

function compareByValue(a, b) {
  return b.valor - a.valor || b.peso - a.peso || b.clientes - a.clientes;
}

function compareTruckPriority(a, b) {
  return (
    b.zonas.length - a.zonas.length ||
    Number(isFlexOnlyUnit(b)) - Number(isFlexOnlyUnit(a)) ||
    b.valor - a.valor ||
    b.peso - a.peso ||
    b.clientes - a.clientes
  );
}

function buildAssignmentReason(unit, tipo, externalCost, netValue) {
  if (tipo === 'camioneta') {
    if (isFlexSingleUnit(unit)) {
      return 'Camioneta priorizada para zona flexible.';
    }

    return 'Unidad compatible con camioneta propia.';
  }

  if (tipo === 'camion') {
    if (unit.zonas.length > 1 && isFlexOnlyUnit(unit)) {
      return 'Camión propio agrupando zonas para cubrir más rutas sin dejarlas pendientes.';
    }

    if (unit.zonas.some((zone) => VAN_RESTRICTED_ZONES.has(zone))) {
      return 'Zona restringida para camioneta; requiere camión.';
    }

    return 'Camión propio asignado por capacidad o para liberar camionetas en zonas prioritarias.';
  }

  if (tipo === 'externo') {
    if (externalCost > 0 && netValue < 0) {
      return 'Camión externo recomendado para cubrir la zona, aunque el margen queda negativo.';
    }

    if (externalCost > 0) {
      return 'Camión externo recomendado para atender la ruta sin dejarla pendiente.';
    }

    return 'Camión externo recomendado para cubrir la ruta; configura el costo para calcular el margen.';
  }

  return 'No hay capacidad propia suficiente y la unidad excede la capacidad asumida de camión externo.';
}

function buildRecommendations(assignments) {
  const notes = [];
  const vans = assignments.filter((assignment) => assignment.tipo === 'camioneta' && isFlexSingleUnit(assignment));
  const groupedTrucks = assignments.filter((assignment) => assignment.tipo === 'camion' && assignment.zonas.length > 1 && isFlexOnlyUnit(assignment));
  const externals = assignments.filter((assignment) => assignment.tipo === 'externo');
  const postponed = assignments.filter((assignment) => assignment.tipo === 'posponer');

  if (vans.length) {
    notes.push(`Se priorizaron camionetas propias para ${vans.map((assignment) => assignment.zonas[0]).join(', ')}.`);
  }

  if (groupedTrucks.length) {
    notes.push(`Conviene agrupar en camión propio: ${groupedTrucks.map((assignment) => unitLabel(assignment)).join('; ')}.`);
  }

  if (externals.length) {
    notes.push(`Usar camión externo para ${externals.map((assignment) => unitLabel(assignment)).join('; ')} para no dejar zonas sin atender.`);
  }

  if (postponed.length) {
    notes.push(`Quedan pospuestas: ${postponed.map((assignment) => unitLabel(assignment)).join('; ')}.`);
  }

  return notes;
}

function assignToVehicles(units, externalCost, vehicleAvailability) {
  const availableVans = [...vehicleAvailability.camionetasDisponibles];
  const availableTrucks = [...vehicleAvailability.camionesDisponibles];
  const assignments = [];
  const assignedSignatures = new Set();

  function markAssigned(unit, payload) {
    assignments.push(payload);
    assignedSignatures.add(unitSignature(unit));
  }

  function isUnassigned(unit) {
    return !assignedSignatures.has(unitSignature(unit));
  }

  const preferredVanUnits = units
    .filter((unit) => isFlexSingleUnit(unit) && canFitVan(unit))
    .sort(compareByValue);

  for (const unit of preferredVanUnits) {
    if (availableVans.length === 0) {
      break;
    }

    const nextVan = availableVans.shift();
    markAssigned(unit, {
      ...unit,
      vehiculo: nextVan.nombre,
      tipo: 'camioneta',
      estado: 'asignado',
      motivo: buildAssignmentReason(unit, 'camioneta', externalCost, unit.valor - externalCost),
    });
  }

  const otherVanUnits = units
    .filter((unit) => isUnassigned(unit) && canFitVan(unit))
    .sort(compareByValue);

  for (const unit of otherVanUnits) {
    if (availableVans.length === 0) {
      break;
    }

    const nextVan = availableVans.shift();
    markAssigned(unit, {
      ...unit,
      vehiculo: nextVan.nombre,
      tipo: 'camioneta',
      estado: 'asignado',
      motivo: buildAssignmentReason(unit, 'camioneta', externalCost, unit.valor - externalCost),
    });
  }

  const truckCandidates = units
    .filter((unit) => isUnassigned(unit) && canFitTruck(unit))
    .sort(compareTruckPriority);

  for (const unit of truckCandidates) {
    if (availableTrucks.length === 0) {
      break;
    }

    const nextTruck = availableTrucks.shift();
    markAssigned(unit, {
      ...unit,
      vehiculo: nextTruck.nombre,
      tipo: 'camion',
      estado: 'asignado',
      motivo: buildAssignmentReason(unit, 'camion', externalCost, unit.valor - externalCost),
    });
  }

  const overflow = units
    .filter((unit) => isUnassigned(unit))
    .sort(compareTruckPriority);

  for (const unit of overflow) {
    const netValue = unit.valor - externalCost;

    if (canFitExternalTruck(unit)) {
      markAssigned(unit, {
        ...unit,
        vehiculo: 'Vehículo Externo',
        tipo: 'externo',
        estado: 'externo',
        costoExterno: externalCost,
        gananciaNeta: netValue,
        motivo: buildAssignmentReason(unit, 'externo', externalCost, netValue),
      });
      continue;
    }

    markAssigned(unit, {
      ...unit,
      vehiculo: null,
      tipo: 'posponer',
      estado: 'posponer',
      costoExterno: externalCost,
      gananciaNeta: netValue,
      motivo: buildAssignmentReason(unit, 'posponer', externalCost, netValue),
    });
  }

  const dispatched = assignments.filter((assignment) => assignment.estado === 'asignado' || assignment.estado === 'externo');
  const postponed = assignments.filter((assignment) => assignment.estado === 'posponer');

  return {
    asignaciones: assignments,
    recomendaciones: buildRecommendations(assignments),
    estrategia: {
      flexAgrupaciones: units
        .filter((unit) => isFlexOnlyUnit(unit))
        .map((unit) => [...unit.zonas]),
      criterio: 'Prioridad de camionetas en NORTE, SUR, CENTRO y OESTE; camión propio o externo para cubrir la mayor cantidad posible de zonas.',
    },
    resumen: {
      camionetasConfiguradas: vehicleAvailability.camionetas.length,
      camionetasHabilitadas: vehicleAvailability.camionetasDisponibles.length,
      camionetasUsadas: vehicleAvailability.camionetasDisponibles.length - availableVans.length,
      camionetasSinUsar: availableVans.length,
      camionesConfigurados: vehicleAvailability.camiones.length,
      camionesHabilitados: vehicleAvailability.camionesDisponibles.length,
      camionesUsados: vehicleAvailability.camionesDisponibles.length - availableTrucks.length,
      camionesSinUsar: availableTrucks.length,
      externosRequeridos: assignments.filter((assignment) => assignment.estado === 'externo').length,
      rutasPospuestas: postponed.length,
      totalValorDespachado: dispatched.reduce((sum, assignment) => sum + assignment.valor, 0),
      totalValorPospuesto: postponed.reduce((sum, assignment) => sum + assignment.valor, 0),
      totalClientesDespachados: dispatched.reduce((sum, assignment) => sum + (assignment.clientes || 0), 0),
      totalClientesPospuestos: postponed.reduce((sum, assignment) => sum + (assignment.clientes || 0), 0),
    },
    disponibilidadVehiculos: {
      camionetas: vehicleAvailability.camionetas,
      camiones: vehicleAvailability.camiones,
    },
  };
}

function scoreDispatchResult(result) {
  const servedZones = result.asignaciones
    .filter((assignment) => assignment.estado === 'asignado' || assignment.estado === 'externo')
    .reduce((sum, assignment) => sum + assignment.zonas.length, 0);
  const externalZones = result.asignaciones
    .filter((assignment) => assignment.estado === 'externo')
    .reduce((sum, assignment) => sum + assignment.zonas.length, 0);
  const postponedZones = result.asignaciones
    .filter((assignment) => assignment.estado === 'posponer')
    .reduce((sum, assignment) => sum + assignment.zonas.length, 0);
  const preferredVanZones = result.asignaciones
    .filter((assignment) => assignment.tipo === 'camioneta' && isFlexSingleUnit(assignment))
    .reduce((sum, assignment) => sum + assignment.zonas.length, 0);
  const ownFleetZones = result.asignaciones
    .filter((assignment) => assignment.estado === 'asignado')
    .reduce((sum, assignment) => sum + assignment.zonas.length, 0);

  return (
    servedZones * 100000 -
    postponedZones * 1000000 -
    externalZones * 1000 +
    preferredVanZones * 100 +
    ownFleetZones * 10 +
    result.resumen.totalValorDespachado / 100
  );
}

function chooseBestDispatchResult(options, externalCost, vehicleAvailability) {
  let bestResult = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const units of options) {
    const result = assignToVehicles(units, externalCost, vehicleAvailability);
    const score = scoreDispatchResult(result);

    if (score > bestScore) {
      bestScore = score;
      bestResult = result;
    }
  }

  return bestResult;
}

exports.getDispatchPage = (req, res) => {
  res.sendFile(path.join(__dirname, '../public/dispatch.html'));
};

exports.calculateDispatch = (req, res) => {
  try {
    const { zonas, costoExterno, vehiculos } = req.body;

    if (!zonas || typeof zonas !== 'object') {
      return res.status(400).json({ error: 'Se requiere el objeto "zonas"' });
    }

    const externalCost = Number(costoExterno) || 0;

    const active = {};
    for (const [zone, data] of Object.entries(zonas)) {
      if (!ZONES_ALL.includes(zone)) continue;
      const peso = Number(data.peso) || 0;
      const valor = Number(data.valor) || 0;
      const clientes = Number(data.clientes) || 0;

      if (peso > 0 || valor > 0 || clientes > 0) {
        active[zone] = { peso, valor, clientes };
      }
    }

    if (Object.keys(active).length === 0) {
      return res.status(400).json({ error: 'No hay zonas activas con datos' });
    }

    const vehicleAvailability = buildVehicleAvailability(vehiculos);
    const dispatchOptions = buildDispatchOptions(active);
    const result = chooseBestDispatchResult(dispatchOptions, externalCost, vehicleAvailability);

    res.json({
      success: true,
      fecha: new Date().toISOString(),
      costoExterno: externalCost,
      zonasActivas: Object.keys(active),
      ...result,
    });
  } catch (error) {
    console.error('Error en calculateDispatch:', error);
    res.status(500).json({ error: 'Error calculando el despacho' });
  }
};

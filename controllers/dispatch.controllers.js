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

function canFitOwnFleet(unit) {
  return canFitVan(unit) || canFitTruck(unit);
}

// ─── STEP 1: Build dispatch units respecting combination rules ────────────────

function buildDispatchUnits(active) {
  const units = [];

  // Mandatory solo zones (each always gets its own vehicle)
  for (const zone of ZONES_SOLO_REQUIRED) {
    if (active[zone]) {
      units.push(buildUnit([zone], active));
    }
  }

  // CABIMAS always goes alone.
  if (active.CABIMAS) {
    units.push(buildUnit(['CABIMAS'], active));
  }

  // OJEDA can go alone, and if MENEGRANDE/BACHAQUERO are active they always attach to OJEDA.
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

  // Flexible zones: NORTE, SUR, CENTRO, OESTE
  const flexActive = ['NORTE', 'SUR', 'CENTRO', 'OESTE'].filter((zone) => active[zone]);
  units.push(...buildFlexUnits(flexActive, active));

  return units;
}

// Tries two pairing options and picks the best one (more pairs, more van-eligible)
function buildFlexUnits(flexActive, active) {
  const remaining = new Set(flexActive);
  const units = [];

  // Both valid full-pairing options for the 4 flexible zones
  const OPTION_SETS = [
    [['NORTE', 'CENTRO'], ['SUR', 'OESTE']],
    [['NORTE', 'OESTE'], ['SUR', 'CENTRO']],
  ];

  let bestPairs = [];
  let bestScore = -1;

  for (const optionSet of OPTION_SETS) {
    const viablePairs = [];
    const tentative = new Set(remaining);

    for (const [a, b] of optionSet) {
      if (!tentative.has(a) || !tentative.has(b)) continue;
      const pairUnit = buildUnit([a, b], active);
      if (canFitOwnFleet(pairUnit)) {
        viablePairs.push([a, b]);
        tentative.delete(a);
        tentative.delete(b);
      }
    }

    // More pairs = better; tiebreak: more van-eligible pairs
    const vanEligibleCount = viablePairs.filter(
      ([a, b]) => canFitVan(buildUnit([a, b], active))
    ).length;
    const score = viablePairs.length * 10 + vanEligibleCount;

    if (score > bestScore) {
      bestScore = score;
      bestPairs = viablePairs;
    }
  }

  for (const [a, b] of bestPairs) {
    if (remaining.has(a) && remaining.has(b)) {
      units.push(buildUnit([a, b], active));
      remaining.delete(a);
      remaining.delete(b);
    }
  }

  for (const zone of remaining) {
    units.push(buildUnit([zone], active));
  }

  return units;
}

// ─── STEP 2: Assign units to vehicles ────────────────────────────────────────

function assignToVehicles(units, externalCost, vehicleAvailability) {
  // Priority: higher value dispatched first
  const sorted = [...units].sort((a, b) => b.valor - a.valor);

  const availableVans = [...vehicleAvailability.camionetasDisponibles];
  const availableTrucks = [...vehicleAvailability.camionesDisponibles];
  const assignments = [];

  const vanEligible = sorted.filter((unit) => canFitVan(unit));
  const needTruck = sorted.filter((unit) => !canFitVan(unit) && canFitTruck(unit));
  const tooBig = sorted.filter((unit) => !canFitTruck(unit));

  // Fill vans first with lightweight units (by value priority)
  const spilloverToTruck = [];
  for (const unit of vanEligible) {
    if (availableVans.length > 0) {
      const nextVan = availableVans.shift();
      assignments.push({ ...unit, vehiculo: nextVan.nombre, tipo: 'camioneta', estado: 'asignado' });
    } else {
      spilloverToTruck.push(unit);
    }
  }

  // Fill trucks with heavy units + van spill (by value priority, already sorted)
  const overflowFinal = [];
  for (const unit of [...spilloverToTruck, ...needTruck]) {
    if (availableTrucks.length > 0) {
      const nextTruck = availableTrucks.shift();
      assignments.push({ ...unit, vehiculo: nextTruck.nombre, tipo: 'camion', estado: 'asignado' });
    } else {
      overflowFinal.push(unit);
    }
  }

  // Fleet exceeded (or weight > 5000) → external vehicle decision
  const overflow = [...overflowFinal, ...tooBig].sort((a, b) => b.valor - a.valor);
  for (const unit of overflow) {
    const netValue = unit.valor - externalCost;
    // External only makes sense when cost is configured and margin is positive
    if (externalCost > 0 && netValue > 0) {
      assignments.push({
        ...unit,
        vehiculo: 'Vehículo Externo',
        tipo: 'externo',
        estado: 'externo',
        costoExterno: externalCost,
        gananciaNeta: netValue,
      });
    } else {
      assignments.push({
        ...unit,
        vehiculo: null,
        tipo: 'posponer',
        estado: 'posponer',
        costoExterno: externalCost,
        gananciaNeta: netValue,
      });
    }
  }

  const dispatched = assignments.filter(a => a.estado === 'asignado' || a.estado === 'externo');
  const postponed  = assignments.filter(a => a.estado === 'posponer');

  return {
    asignaciones: assignments,
    resumen: {
      camionetasConfiguradas: vehicleAvailability.camionetas.length,
      camionetasHabilitadas: vehicleAvailability.camionetasDisponibles.length,
      camionetasUsadas: vehicleAvailability.camionetasDisponibles.length - availableVans.length,
      camionetasSinUsar: availableVans.length,
      camionesConfigurados: vehicleAvailability.camiones.length,
      camionesHabilitados: vehicleAvailability.camionesDisponibles.length,
      camionesUsados: vehicleAvailability.camionesDisponibles.length - availableTrucks.length,
      camionesSinUsar: availableTrucks.length,
      externosRequeridos: assignments.filter(a => a.estado === 'externo').length,
      rutasPospuestas: postponed.length,
      totalValorDespachado: dispatched.reduce((s, a) => s + a.valor, 0),
      totalValorPospuesto: postponed.reduce((s, a) => s + a.valor, 0),
      totalClientesDespachados: dispatched.reduce((s, a) => s + (a.clientes || 0), 0),
      totalClientesPospuestos: postponed.reduce((s, a) => s + (a.clientes || 0), 0),
    },
    disponibilidadVehiculos: {
      camionetas: vehicleAvailability.camionetas,
      camiones: vehicleAvailability.camiones,
    },
  };
}

// ─── Controllers ─────────────────────────────────────────────────────────────

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
      const peso  = Number(data.peso)  || 0;
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
    const units  = buildDispatchUnits(active);
    const result = assignToVehicles(units, externalCost, vehicleAvailability);

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

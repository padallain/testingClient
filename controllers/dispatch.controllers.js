const path = require('path');

const ZONES_ALL = ['SUR', 'CENTRO', 'OESTE', 'NORTE', 'OJEDA', 'MENEGRANDE', 'CABIMAS', 'MACHIQUES', 'PUERTOS', 'CONCEPCIÓN', 'MARA', 'BACHAQUERO'];
const ZONES_SOLO_REQUIRED = new Set(['MACHIQUES', 'PUERTOS', 'CONCEPCIÓN', 'MARA', 'BACHAQUERO']);
const VAN_COUNT = 3;
const VAN_CAP = 950;
const TRUCK_COUNT = 3;
const TRUCK_CAP = 5000;
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

// ─── STEP 1: Build dispatch units respecting combination rules ────────────────

function buildDispatchUnits(active) {
  const units = [];

  // Mandatory solo zones (each always gets its own vehicle)
  for (const zone of ZONES_SOLO_REQUIRED) {
    if (active[zone]) {
      units.push({ zonas: [zone], peso: active[zone].peso, valor: active[zone].valor });
    }
  }

  // OJEDA group: absorbs CABIMAS and/or MENEGRANDE when OJEDA is active
  if (active['OJEDA']) {
    const group = { zonas: ['OJEDA'], peso: active['OJEDA'].peso, valor: active['OJEDA'].valor };
    if (active['CABIMAS']) {
      group.zonas.push('CABIMAS');
      group.peso += active['CABIMAS'].peso;
      group.valor += active['CABIMAS'].valor;
    }
    if (active['MENEGRANDE']) {
      group.zonas.push('MENEGRANDE');
      group.peso += active['MENEGRANDE'].peso;
      group.valor += active['MENEGRANDE'].valor;
    }
    units.push(group);
  } else {
    // OJEDA inactive → CABIMAS and MENEGRANDE must go alone (no valid partner)
    if (active['CABIMAS']) {
      units.push({ zonas: ['CABIMAS'], peso: active['CABIMAS'].peso, valor: active['CABIMAS'].valor });
    }
    if (active['MENEGRANDE']) {
      units.push({ zonas: ['MENEGRANDE'], peso: active['MENEGRANDE'].peso, valor: active['MENEGRANDE'].valor });
    }
  }

  // Flexible zones: NORTE, SUR, CENTRO, OESTE
  const flexActive = ['NORTE', 'SUR', 'CENTRO', 'OESTE'].filter(z => active[z]);
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
      const combinedPeso = (active[a]?.peso || 0) + (active[b]?.peso || 0);
      if (combinedPeso <= TRUCK_CAP) {
        viablePairs.push([a, b]);
        tentative.delete(a);
        tentative.delete(b);
      }
    }

    // More pairs = better; tiebreak: more van-eligible pairs
    const vanEligibleCount = viablePairs.filter(
      ([a, b]) => (active[a]?.peso || 0) + (active[b]?.peso || 0) <= VAN_CAP
    ).length;
    const score = viablePairs.length * 10 + vanEligibleCount;

    if (score > bestScore) {
      bestScore = score;
      bestPairs = viablePairs;
    }
  }

  for (const [a, b] of bestPairs) {
    if (remaining.has(a) && remaining.has(b)) {
      units.push({
        zonas: [a, b],
        peso: (active[a]?.peso || 0) + (active[b]?.peso || 0),
        valor: (active[a]?.valor || 0) + (active[b]?.valor || 0),
      });
      remaining.delete(a);
      remaining.delete(b);
    }
  }

  for (const zone of remaining) {
    units.push({ zonas: [zone], peso: active[zone].peso, valor: active[zone].valor });
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

  const vanEligible = sorted.filter(u => u.peso <= VAN_CAP);
  const needTruck   = sorted.filter(u => u.peso > VAN_CAP && u.peso <= TRUCK_CAP);
  const tooBig      = sorted.filter(u => u.peso > TRUCK_CAP);

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
      if (peso > 0 || valor > 0) {
        active[zone] = { peso, valor };
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

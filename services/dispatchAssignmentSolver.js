/**
 * Asignación de zonas a vehículos formulada como un problema de
 * optimización combinatoria real (bin-packing con 3 tipos de contenedor +
 * un "contenedor nulo") y resuelta con branch & bound exacto con poda por
 * cotas admisibles, en vez de fuerza bruta sobre particiones de zonas
 * pre-enumeradas a mano con una función de score de exponentes gigantes.
 *
 * Este motor es agnóstico de ciudad: no conoce nombres de zona. Toda regla
 * de negocio específica (qué zonas son prioritarias, cuáles van dedicadas,
 * cuáles no pueden usar camioneta, qué pares de zonas no pueden compartir
 * vehículo) entra como parámetro (ver `solveDispatchAssignment`) — quien
 * llama (hoy `optimizador.js`, con un default para Maracaibo) decide esas
 * reglas, no este archivo.
 *
 * Contenedores disponibles para cada zona:
 *   - un grupo respaldado por una camioneta propia (costo marginal 0,
 *     oferta limitada al tamaño de flota, capacidad limitada),
 *   - un grupo respaldado por un camión propio (ídem, otra capacidad),
 *   - un grupo "externo" (capacidad 5000kg, costo fijo por grupo abierto,
 *     oferta prácticamente ilimitada; varias zonas pueden compartir un
 *     mismo grupo externo para repartirse ese costo fijo),
 *   - "mañana" (sin costo directo, pero sin generar valor hoy).
 *
 * Como las camionetas son idénticas entre sí (y los camiones también), no
 * se distingue "cuál camioneta específica" recibe cada grupo: solo se
 * cuenta cuántos grupos de cada tipo están abiertos. Esto elimina de raíz
 * la simetría por permutación de vehículos intercambiables, que es la
 * causa de que un ILP genérico con variables por-vehículo-individual
 * explote combinatoriamente en este problema.
 *
 * El criterio de selección es una comparación lexicográfica de 3 niveles
 * (en vez de un solo score con coeficientes 1e12/1e13 sin justificar):
 *   1) minimizar el peso de prioridad (configurable por zona) que queda
 *      pospuesto,
 *   2) maximizar el valor neto despachado hoy en dólares reales (valor de
 *      zonas no pospuestas, menos el costo real de los grupos externos
 *      efectivamente usados),
 *   3) minimizar un costo operativo de desempate (preferir camionetas
 *      sobre camiones, y vehículos propios sobre externo, cuando el
 *      resultado económico es idéntico).
 *
 * La poda es real: en cada nodo se calcula una cota optimista y admisible
 * de la mejor tupla alcanzable completando las zonas restantes, y la rama
 * se descarta si esa cota no puede superar a la mejor solución encontrada
 * hasta el momento.
 */

const EXTERNAL_CAPACITY_KG = 5000;
const EXTERNAL_CAPACITY_CLIENTES = Number.MAX_SAFE_INTEGER;
const MAX_EXTERNAL_GROUPS = 10;
const OWN_VEHICLE_TIEBREAK_COST = 1;
const EXTERNAL_TIEBREAK_COST = 2;
const VALUE_EPSILON = 1e-6;
const MAX_NODES = 4_000_000;
const MAX_TIME_MS = 5000;

function pairKey(zoneA, zoneB) {
  return zoneA < zoneB ? `${zoneA}|${zoneB}` : `${zoneB}|${zoneA}`;
}

/** Construye un Set de claves canónicas a partir de pares [zonaA, zonaB]. */
function buildIncompatibilitySet(pairs) {
  const set = new Set();
  for (const pair of pairs || []) {
    if (Array.isArray(pair) && pair.length === 2 && pair[0] && pair[1] && pair[0] !== pair[1]) {
      set.add(pairKey(pair[0], pair[1]));
    }
  }
  return set;
}

/** ¿Puede `candidateZone` compartir vehículo con `existingZones`? */
function isCompatibleWithGroup(existingZones, candidateZone, incompatiblePairs) {
  return !existingZones.some((name) => incompatiblePairs.has(pairKey(name, candidateZone)));
}

function vehicleAllowsZone(vehicle, zoneName) {
  if (!vehicle) {
    return true;
  }

  if (!Array.isArray(vehicle.zonasPermitidas) || vehicle.zonasPermitidas.length === 0) {
    return true;
  }

  return vehicle.zonasPermitidas.includes(zoneName);
}

function capacityForGroup(group, context) {
  if (group.tipo === 'externo') {
    return { kg: EXTERNAL_CAPACITY_KG, clientes: EXTERNAL_CAPACITY_CLIENTES };
  }

  const vehicle = context.vehicleMap.get(String(group.vehicleId));
  return vehicle ? { kg: vehicle.capacidadKg, clientes: vehicle.capacidadClientes } : { kg: 0, clientes: 0 };
}

function canOpenOwnGroup(vehicle, zone) {
  if (!vehicleAllowsZone(vehicle, zone.nombre)) {
    return false;
  }

  return zone.kg <= vehicle.capacidadKg && zone.clientes <= vehicle.capacidadClientes;
}

function canJoinGroup(group, zone, context) {
  if (group.tipo === 'propio') {
    const vehicle = context.vehicleMap.get(String(group.vehicleId));
    if (!vehicleAllowsZone(vehicle, zone.nombre)) {
      return false;
    }
  }

  if (context.dedicatedZones.has(zone.nombre)) return false; // zona dedicada: nunca comparte vehículo
  if (group.zonas.some((name) => context.dedicatedZones.has(name))) return false;
  if (!isCompatibleWithGroup(group.zonas, zone.nombre, context.incompatiblePairs)) return false;

  const cap = capacityForGroup(group, context);
  if (group.kg + zone.kg > cap.kg) return false;
  if (group.clientes + zone.clientes > cap.clientes) return false;

  return true;
}

function isBetterTuple(candidate, incumbent) {
  if (candidate.pendingPriority !== incumbent.pendingPriority) {
    return candidate.pendingPriority < incumbent.pendingPriority;
  }
  if (Math.abs(candidate.netValue - incumbent.netValue) > VALUE_EPSILON) {
    return candidate.netValue > incumbent.netValue;
  }
  if (candidate.vehicleTieCost !== incumbent.vehicleTieCost) {
    return candidate.vehicleTieCost < incumbent.vehicleTieCost;
  }
  return false;
}

function cloneGroups(groups) {
  return groups.map((group) => ({
    tipo: group.tipo,
    vehicleId: group.vehicleId,
    zonas: [...group.zonas],
    kg: group.kg,
    clientes: group.clientes,
  }));
}

/**
 * Resuelve la asignación óptima de `zones` a vehículos propios
 * configurados individualmente / externo / mañana.
 *
 * Parámetros de reglas de negocio (todos configurables por quien llama,
 * este módulo no asume ninguna zona en particular):
 *   - priorityWeights: Map(nombreZona -> peso). Peso 0 o ausente = zona
 *     no prioritaria (nunca bloquea la etapa 1 de la comparación).
 *   - dedicatedZones: Set(nombreZona) que nunca comparte vehículo con
 *     ninguna otra zona (viaja siempre sola).
 *   - incompatiblePairs: Set de claves canónicas "a|b" (usar
 *     buildIncompatibilitySet) — pares de zonas que no pueden compartir
 *     vehículo entre sí.
 */
function solveDispatchAssignment({
  zones,
  vehicles,
  externalCost,
  priorityWeights,
  dedicatedZones,
  incompatiblePairs,
}) {
  if (!zones.length) {
    return {
      groups: [],
      deferred: [],
      diagnostics: { pendingPriority: 0, netValue: 0, nodesExplored: 0, aborted: false },
    };
  }

  const orderedZones = [...zones].sort((a, b) => {
    const weightDiff = (priorityWeights.get(b.nombre) || 0) - (priorityWeights.get(a.nombre) || 0);
    if (weightDiff !== 0) return weightDiff;
    return b.valor_dolares - a.valor_dolares;
  });

  const availableVehicles = [...(Array.isArray(vehicles) ? vehicles : [])]
    .map((vehicle) => ({ ...vehicle, id: String(vehicle.id) }))
    .sort((left, right) => {
      if (right.capacidadKg !== left.capacidadKg) {
        return right.capacidadKg - left.capacidadKg;
      }

      if (right.capacidadClientes !== left.capacidadClientes) {
        return right.capacidadClientes - left.capacidadClientes;
      }

      return String(left.id).localeCompare(String(right.id), 'es');
    });

  const suffixValue = new Array(orderedZones.length + 1).fill(0);
  for (let i = orderedZones.length - 1; i >= 0; i -= 1) {
    suffixValue[i] = suffixValue[i + 1] + orderedZones[i].valor_dolares;
  }

  const context = {
    vehicleMap: new Map(availableVehicles.map((vehicle) => [String(vehicle.id), vehicle])),
    dedicatedZones,
    incompatiblePairs: incompatiblePairs || new Set(),
  };

  const maxExternalGroups = Math.min(orderedZones.length, MAX_EXTERNAL_GROUPS);

  const openGroups = [];
  const deferred = [];
  let externalCount = 0;
  let pendingPriority = 0;
  let netValue = 0;
  let vehicleTieCost = 0;
  const usedVehicleIds = new Set();

  let incumbent = null;
  let nodesExplored = 0;
  let aborted = false;
  const deadline = Date.now() + MAX_TIME_MS;

  function currentTuple() {
    return { pendingPriority, netValue, vehicleTieCost };
  }

  function boundTuple(index) {
    return {
      pendingPriority, // cota admisible: no puede bajar, solo subir
      netValue: netValue + suffixValue[index], // cota optimista: resto gratis
      vehicleTieCost, // cota admisible: no puede bajar
    };
  }

  function recordIncumbentIfBetter() {
    const tuple = currentTuple();
    if (!incumbent || isBetterTuple(tuple, incumbent.tuple)) {
      incumbent = {
        tuple,
        groups: cloneGroups(openGroups),
        deferred: [...deferred],
      };
    }
  }

  function search(index) {
    nodesExplored += 1;
    if (nodesExplored > MAX_NODES || Date.now() > deadline) {
      aborted = true;
      return;
    }

    if (index === orderedZones.length) {
      recordIncumbentIfBetter();
      return;
    }

    if (incumbent && !isBetterTuple(boundTuple(index), incumbent.tuple)) {
      return; // poda: ni en el mejor caso esta rama supera al incumbente
    }

    const zone = orderedZones[index];
    const zoneWeight = priorityWeights.get(zone.nombre) || 0;

    // Opción 1: sumarse a un grupo ya abierto compatible.
    for (const group of openGroups) {
      if (!canJoinGroup(group, zone, context)) continue;

      group.zonas.push(zone.nombre);
      group.kg += zone.kg;
      group.clientes += zone.clientes;
      netValue += zone.valor_dolares;

      search(index + 1);
      if (aborted) return;

      netValue -= zone.valor_dolares;
      group.clientes -= zone.clientes;
      group.kg -= zone.kg;
      group.zonas.pop();
    }

    // Opción 2: abrir un grupo nuevo en un vehículo propio disponible.
    const seenVehicleSignatures = new Set();

    for (const vehicle of availableVehicles) {
      if (usedVehicleIds.has(vehicle.id) || !canOpenOwnGroup(vehicle, zone)) {
        continue;
      }

      const signature = `${vehicle.capacidadKg}|${vehicle.capacidadClientes}|${(vehicle.zonasPermitidas || []).join(',')}`;
      if (seenVehicleSignatures.has(signature)) {
        continue;
      }
      seenVehicleSignatures.add(signature);

      openGroups.push({ tipo: 'propio', vehicleId: vehicle.id, zonas: [zone.nombre], kg: zone.kg, clientes: zone.clientes });
      usedVehicleIds.add(vehicle.id);
      netValue += zone.valor_dolares;
      vehicleTieCost += OWN_VEHICLE_TIEBREAK_COST;

      search(index + 1);
      if (aborted) return;

      vehicleTieCost -= OWN_VEHICLE_TIEBREAK_COST;
      netValue -= zone.valor_dolares;
      usedVehicleIds.delete(vehicle.id);
      openGroups.pop();
    }

    // Opción 3: abrir un grupo nuevo externo.
    if (externalCount < maxExternalGroups && zone.kg <= EXTERNAL_CAPACITY_KG && zone.clientes <= EXTERNAL_CAPACITY_CLIENTES) {
      openGroups.push({ tipo: 'externo', zonas: [zone.nombre], kg: zone.kg, clientes: zone.clientes });
      externalCount += 1;
      netValue += zone.valor_dolares - externalCost;
      vehicleTieCost += EXTERNAL_TIEBREAK_COST;

      search(index + 1);
      if (aborted) return;

      vehicleTieCost -= EXTERNAL_TIEBREAK_COST;
      netValue -= zone.valor_dolares - externalCost;
      externalCount -= 1;
      openGroups.pop();
    }

    // Opción 4: postergar para mañana.
    deferred.push(zone.nombre);
    pendingPriority += zoneWeight;

    search(index + 1);

    pendingPriority -= zoneWeight;
    deferred.pop();
  }

  search(0);

  if (!incumbent) {
    // Salvaguarda: no debería ocurrir, "mañana" siempre es factible.
    incumbent = { tuple: { pendingPriority: 0, netValue: 0, vehicleTieCost: 0 }, groups: [], deferred: orderedZones.map((z) => z.nombre) };
  }

  return {
    groups: incumbent.groups,
    deferred: incumbent.deferred,
    diagnostics: {
      pendingPriority: incumbent.tuple.pendingPriority,
      netValue: Math.round(incumbent.tuple.netValue * 100) / 100,
      nodesExplored,
      aborted,
    },
  };
}

module.exports = {
  solveDispatchAssignment,
  buildIncompatibilitySet,
};

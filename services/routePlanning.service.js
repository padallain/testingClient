const axios = require("axios");

const ORIGIN = { latitude: 10.578208693113535, longitude: -71.67338068775426 };
const START_ID = "317554345";
const MAX_WAYPOINTS = 10;
const OPENROUTESERVICE_API_KEY = process.env.OPENROUTESERVICE_API_KEY || process.env.ORS_API_KEY || "";
const OPENROUTESERVICE_MATRIX_URL = "https://api.openrouteservice.org/v2/matrix/driving-car";
const CABIMAS_BOUNDS = {
  minLatitude: 10.36,
  maxLatitude: 10.47,
  minLongitude: -71.46,
  maxLongitude: -71.34,
};
const CABIMAS_ROUTE_ORIGIN = { latitude: 10.435931, longitude: -71.399238 };

const ROUTE_TYPE_META = {
  closest: {
    type: "closest",
    label: "Mas cercana",
    description: "Prioriza siempre el siguiente cliente mas cercano.",
  },
  farthest: {
    type: "farthest",
    label: "Lejanos primero",
    description: "Empieza por los puntos mas alejados y luego regresa hacia zonas cercanas.",
  },
  alphabetical: {
    type: "alphabetical",
    label: "Orden alfabetico",
    description: "Ordena la visita por nombre del cliente para una revision manual.",
  },
  mirrored: {
    type: "mirrored",
    label: "Espejo",
    description: "Invierte la ruta optima. Ideal para cubrir la zona contraria primero sin recalcular.",
  },
};

const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const toRadians = (degrees) => degrees * (Math.PI / 180);
  const R = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const toRoundedDistance = (value) => Number(value.toFixed(2));

const hasValidLocation = (location) => Number.isFinite(Number(location?.latitude))
  && Number.isFinite(Number(location?.longitude));

const toCoordinateTuple = (location) => [
  Number(location.longitude),
  Number(location.latitude),
];

const isLocationWithinBounds = (location, bounds) => {
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);

  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= bounds.minLatitude
    && latitude <= bounds.maxLatitude
    && longitude >= bounds.minLongitude
    && longitude <= bounds.maxLongitude;
};

const normalizeWeight = (value) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return 0;
  }

  return numericValue;
};

const buildRouteLabel = ({ routeId, driverId, requestedLabel }) => {
  const normalizedRouteId = String(routeId || "").trim();

  if (normalizedRouteId) {
    return `RUTA-${normalizedRouteId}`;
  }

  const normalizedDriverId = String(driverId || "SIN_CHOFER").trim() || "SIN_CHOFER";
  const normalizedLabel = typeof requestedLabel === "string" ? requestedLabel.trim() : "";
  const dateTag = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);

  return normalizedLabel
    ? `RUTA-${normalizedDriverId}-${dateTag}-${normalizedLabel.replace(/\s+/g, "-").toUpperCase()}`
    : `RUTA-${normalizedDriverId}-${dateTag}`;
};

const normalizeRequestedStops = ({ ids, stops }) => {
  const normalizedStops = Array.isArray(stops)
    ? stops
    : Array.isArray(ids)
      ? ids.map((id) => ({ clientId: id }))
      : null;

  if (!Array.isArray(normalizedStops)) {
    return {
      normalizedStops: null,
      uniqueStops: [],
      duplicateClientIds: [],
    };
  }

  const aggregatedStops = new Map();
  const duplicateClientIds = [];

  normalizedStops.forEach((rawStop) => {
    const clientId = String(rawStop?.clientId ?? rawStop?.id ?? "").trim();
    if (!clientId) return;

    const sucursal = typeof rawStop?.sucursal === "string" ? rawStop.sucursal.trim() : "";
    // Two branches of the same chain are different stops — key includes sucursal
    const stopKey = sucursal ? `${clientId}|${sucursal}` : clientId;

    if (aggregatedStops.has(stopKey)) {
      duplicateClientIds.push(clientId);
      return;
    }

    aggregatedStops.set(stopKey, { clientId, sucursal });
  });

  return {
    normalizedStops,
    uniqueStops: Array.from(aggregatedStops.values()),
    duplicateClientIds,
  };
};

const buildMissingClients = (uniqueIds, foundIds) => {
  const notFoundIds = uniqueIds.filter((id) => !foundIds.includes(id));
  const notFoundClients = notFoundIds.map((id) => ({
    clientId: id,
    resolved: false,
    resolvedAt: null,
  }));

  return {
    notFoundIds,
    notFoundClients,
  };
};

const getClientsWithCoordinates = (clients) => clients.filter((client) => hasValidLocation(client?.location));

const splitStartClient = (clients, anchorId) => {
  const effectiveAnchorId = anchorId || START_ID;
  const startClientIndex = clients.findIndex((client) => client.id === effectiveAnchorId);
  const startClient = startClientIndex !== -1 ? clients[startClientIndex] : null;
  const restClients = startClientIndex !== -1
    ? [
      ...clients.slice(0, startClientIndex),
      ...clients.slice(startClientIndex + 1),
    ]
    : clients;

  return {
    startClient,
    restClients,
  };
};

const buildRoundTripCoordinates = (route, origin = ORIGIN) => {
  const coordinates = [
    [origin.longitude, origin.latitude],
    ...route.map((client) => toCoordinateTuple(client.location)),
  ];

  if (route.length > 0) {
    coordinates.push([origin.longitude, origin.latitude]);
  }

  return coordinates;
};

const routeUsesCabimasOrigin = (route) => Array.isArray(route)
  && route.some((client) => isLocationWithinBounds(client?.location, CABIMAS_BOUNDS));

const resolveRouteOrigin = (route) => (routeUsesCabimasOrigin(route) ? CABIMAS_ROUTE_ORIGIN : ORIGIN);

const buildIndexedClients = (clients, anchorId) => {
  const clientsWithCoordinates = getClientsWithCoordinates(clients);

  if (clientsWithCoordinates.length === 0) {
    return {
      startClient: null,
      indexedClients: [],
    };
  }

  const { startClient, restClients } = splitStartClient(clientsWithCoordinates, anchorId);
  const orderedClients = startClient ? [startClient, ...restClients] : restClients;

  return {
    startClient: startClient ? { ...startClient, matrixIndex: 1 } : null,
    indexedClients: orderedClients.map((client, index) => ({
      ...client,
      matrixIndex: index + 1,
    })),
  };
};

const stripMatrixIndex = (route) => route.map(({ matrixIndex, ...client }) => client);

const buildGeodesicDistanceMatrix = (indexedClients, origin = ORIGIN) => {
  const nodes = [{ location: origin }, ...indexedClients];

  return nodes.map((fromNode) => nodes.map((toNode) => {
    if (fromNode === toNode) {
      return 0;
    }

    return calculateDistance(
      Number(fromNode.location.latitude),
      Number(fromNode.location.longitude),
      Number(toNode.location.latitude),
      Number(toNode.location.longitude),
    );
  }));
};

const normalizeRoadDistanceMatrix = (distances, expectedLength) => {
  if (!Array.isArray(distances) || distances.length !== expectedLength) {
    return null;
  }

  const normalizedMatrix = distances.map((row) => {
    if (!Array.isArray(row) || row.length !== expectedLength) {
      return null;
    }

    return row.map((value) => {
      const numericValue = Number(value);
      return Number.isFinite(numericValue) ? numericValue : Infinity;
    });
  });

  return normalizedMatrix.every(Boolean) ? normalizedMatrix : null;
};

const fetchRoadDistanceMatrix = async (indexedClients, origin = ORIGIN) => {
  if (!OPENROUTESERVICE_API_KEY || indexedClients.length === 0) {
    return null;
  }

  try {
    const response = await axios.post(
      OPENROUTESERVICE_MATRIX_URL,
      {
        locations: [
          [origin.longitude, origin.latitude],
          ...indexedClients.map((client) => toCoordinateTuple(client.location)),
        ],
        metrics: ["distance"],
        units: "km",
      },
      {
        headers: {
          Authorization: OPENROUTESERVICE_API_KEY,
          "Content-Type": "application/json",
        },
        timeout: 20000,
      },
    );

    return normalizeRoadDistanceMatrix(response.data?.distances, indexedClients.length + 1);
  } catch (_error) {
    return null;
  }
};

const getMatrixDistance = (distanceMatrix, fromIndex, toIndex) => {
  const distance = Number(distanceMatrix?.[fromIndex]?.[toIndex]);

  return Number.isFinite(distance) ? distance : Infinity;
};

const calculateClosedRouteDistanceFromMatrix = (route, distanceMatrix) => {
  if (!Array.isArray(route) || route.length === 0) {
    return 0;
  }

  let totalDistance = getMatrixDistance(distanceMatrix, 0, route[0].matrixIndex);

  for (let index = 1; index < route.length; index += 1) {
    totalDistance += getMatrixDistance(
      distanceMatrix,
      route[index - 1].matrixIndex,
      route[index].matrixIndex,
    );
  }

  totalDistance += getMatrixDistance(distanceMatrix, route[route.length - 1].matrixIndex, 0);

  return totalDistance;
};

const reverseRouteSegment = (route, startIndex, endIndex) => ([
  ...route.slice(0, startIndex),
  ...route.slice(startIndex, endIndex + 1).reverse(),
  ...route.slice(endIndex + 1),
]);

const optimizeClosedRouteWithTwoOpt = (route, distanceMatrix, lockedPrefixLength = 0) => {
  if (!Array.isArray(route) || route.length < 3) {
    return route;
  }

  let bestRoute = [...route];
  let bestDistance = calculateClosedRouteDistanceFromMatrix(bestRoute, distanceMatrix);
  let improved = true;

  while (improved) {
    improved = false;

    for (let startIndex = lockedPrefixLength; startIndex < bestRoute.length - 1; startIndex += 1) {
      for (let endIndex = startIndex + 1; endIndex < bestRoute.length; endIndex += 1) {
        const candidateRoute = reverseRouteSegment(bestRoute, startIndex, endIndex);
        const candidateDistance = calculateClosedRouteDistanceFromMatrix(candidateRoute, distanceMatrix);

        if (candidateDistance + 0.001 < bestDistance) {
          bestRoute = candidateRoute;
          bestDistance = candidateDistance;
          improved = true;
        }
      }
    }
  }

  return bestRoute;
};

const buildGreedyRoute = (indexedClients, distanceMatrix, pickFarthest = false) => {
  if (indexedClients.length === 0) {
    return [];
  }

  const route = [];
  const hasLockedStart = indexedClients[0].id === START_ID;
  let currentIndex = 0;
  const unvisited = [...indexedClients];

  if (hasLockedStart) {
    const [fixedStart] = unvisited.splice(0, 1);
    route.push(fixedStart);
    currentIndex = fixedStart.matrixIndex;
  }

  while (unvisited.length > 0) {
    let targetIdx = 0;
    let targetDistance = getMatrixDistance(distanceMatrix, currentIndex, unvisited[0].matrixIndex);

    for (let index = 1; index < unvisited.length; index += 1) {
      const distance = getMatrixDistance(distanceMatrix, currentIndex, unvisited[index].matrixIndex);
      const shouldReplace = pickFarthest ? distance > targetDistance : distance < targetDistance;

      if (shouldReplace) {
        targetDistance = distance;
        targetIdx = index;
      }
    }

    const [nextClient] = unvisited.splice(targetIdx, 1);
    route.push(nextClient);
    currentIndex = nextClient.matrixIndex;
  }

  return route;
};

const buildAlphabeticalRoute = (indexedClients) => {
  if (indexedClients.length === 0) {
    return [];
  }

  const hasLockedStart = indexedClients[0].id === START_ID;
  const [fixedStart, ...remainingClients] = hasLockedStart ? indexedClients : [null, ...indexedClients];
  const sortedClients = [...remainingClients].sort((leftClient, rightClient) => {
    const leftKey = `${String(leftClient.nombre || "").trim().toLowerCase()}-${String(leftClient.id || "")}`;
    const rightKey = `${String(rightClient.nombre || "").trim().toLowerCase()}-${String(rightClient.id || "")}`;

    return leftKey.localeCompare(rightKey, "es");
  });

  return fixedStart ? [fixedStart, ...sortedClients] : sortedClients;
};

const calculateRouteDistanceFallback = (route, origin = ORIGIN) => {
  if (!Array.isArray(route) || route.length === 0) {
    return 0;
  }

  let totalDistance = 0;
  let previousPoint = origin;

  route.forEach((client) => {
    totalDistance += calculateDistance(
      previousPoint.latitude,
      previousPoint.longitude,
      client.location.latitude,
      client.location.longitude,
    );
    previousPoint = client.location;
  });

  totalDistance += calculateDistance(
    previousPoint.latitude,
    previousPoint.longitude,
    origin.latitude,
    origin.longitude,
  );

  return toRoundedDistance(totalDistance);
};

const buildRouteContext = async (clients, options = {}) => {
  const { startClient, indexedClients } = buildIndexedClients(clients, options.anchorClientId);
  const routeOrigin = resolveRouteOrigin(indexedClients);

  if (indexedClients.length === 0) {
    return {
      startClient,
      indexedClients,
      distanceMatrix: [],
      distanceSource: "none",
      routeOrigin,
    };
  }

  const roadDistanceMatrix = await fetchRoadDistanceMatrix(indexedClients, routeOrigin);

  return {
    startClient,
    indexedClients,
    distanceMatrix: roadDistanceMatrix || buildGeodesicDistanceMatrix(indexedClients, routeOrigin),
    distanceSource: roadDistanceMatrix ? "road" : "geodesic",
    routeOrigin,
  };
};

const buildRouteOption = (routeMeta, route, distanceMatrix, lockedPrefixLength = 0) => {
  const optimizedRoute = routeMeta.type === "alphabetical"
    ? route
    : optimizeClosedRouteWithTwoOpt(route, distanceMatrix, lockedPrefixLength);

  return {
    ...routeMeta,
    route: stripMatrixIndex(optimizedRoute),
    estimatedDistanceKm: toRoundedDistance(calculateClosedRouteDistanceFromMatrix(optimizedRoute, distanceMatrix)),
  };
};

const buildOptimizedRoute = async (clients) => {
  const routeOptions = await buildRouteOptions(clients);
  return routeOptions[0]?.route || [];
};

const buildMirroredIndexedRoute = (optimizedRoute, lockedPrefixLength) => {
  if (lockedPrefixLength > 0) {
    const anchorStops = optimizedRoute.slice(0, lockedPrefixLength);
    const remainingStops = optimizedRoute.slice(lockedPrefixLength);
    return [...anchorStops, ...remainingStops.reverse()];
  }

  return [...optimizedRoute].reverse();
};

const buildRouteOptions = async (clients, options = {}) => {
  const { startClient, indexedClients, distanceMatrix } = await buildRouteContext(clients, options);

  if (indexedClients.length === 0) {
    return [];
  }

  const lockedPrefixLength = startClient ? 1 : 0;

  const closestGreedy = buildGreedyRoute(indexedClients, distanceMatrix, false);
  const closestOptimized = optimizeClosedRouteWithTwoOpt(closestGreedy, distanceMatrix, lockedPrefixLength);
  const mirroredIndexed = buildMirroredIndexedRoute(closestOptimized, lockedPrefixLength);

  const optionBuilders = [
    buildRouteOption(
      ROUTE_TYPE_META.closest,
      closestGreedy,
      distanceMatrix,
      lockedPrefixLength,
    ),
    buildRouteOption(
      ROUTE_TYPE_META.farthest,
      buildGreedyRoute(indexedClients, distanceMatrix, true),
      distanceMatrix,
      lockedPrefixLength,
    ),
    buildRouteOption(
      ROUTE_TYPE_META.alphabetical,
      buildAlphabeticalRoute(indexedClients),
      distanceMatrix,
      lockedPrefixLength,
    ),
  ].filter((option) => option.route.length > 0);

  if (mirroredIndexed.length > 0) {
    optionBuilders.push({
      ...ROUTE_TYPE_META.mirrored,
      route: stripMatrixIndex(mirroredIndexed),
      estimatedDistanceKm: toRoundedDistance(
        calculateClosedRouteDistanceFromMatrix(mirroredIndexed, distanceMatrix),
      ),
    });
  }

  const seenSignatures = new Set();

  return optionBuilders.filter((option) => {
    const signature = option.route.map((client) => client.id).join("|");

    if (seenSignatures.has(signature)) {
      return false;
    }

    seenSignatures.add(signature);
    return true;
  }).sort((leftOption, rightOption) => leftOption.estimatedDistanceKm - rightOption.estimatedDistanceKm);
};

const calculateRouteDistance = async (route) => {
  if (!Array.isArray(route) || route.length === 0) {
    return 0;
  }

  const { indexedClients, distanceMatrix, routeOrigin } = await buildRouteContext(route.map((client, index) => ({
    ...client,
    id: String(client.id || client.clientId || `route-stop-${index + 1}`),
  })));

  if (indexedClients.length !== route.length) {
    return calculateRouteDistanceFallback(route, routeOrigin);
  }

  return toRoundedDistance(calculateClosedRouteDistanceFromMatrix(indexedClients, distanceMatrix));
};

const buildRouteArtifacts = (route) => {
  const routeOrigin = resolveRouteOrigin(route);
  const response = route.map((client) => ({
    id: client.id,
    nombre: client.sucursal ? `${client.nombre} — ${client.sucursal}` : client.nombre,
    sucursal: client.sucursal || "",
    weight: client.weight,
    location: client.location,
    googleMapsLink: `https://www.google.com/maps?q=${client.location.latitude},${client.location.longitude}`,
  }));

  const googleMapsRouteLinks = [];
  let startPoint = `${routeOrigin.latitude},${routeOrigin.longitude}`;

  for (let i = 0; i < route.length; i += MAX_WAYPOINTS - 1) {
    const segment = route.slice(i, i + (MAX_WAYPOINTS - 1));
    const isLastSegment = i + (MAX_WAYPOINTS - 1) >= route.length;
    const waypoints = [
      startPoint,
      ...segment.map((client) => `${client.location.latitude},${client.location.longitude}`),
      ...(isLastSegment ? [`${routeOrigin.latitude},${routeOrigin.longitude}`] : []),
    ].join("/");
    googleMapsRouteLinks.push(`https://www.google.com/maps/dir/${waypoints}`);

    const lastClient = segment[segment.length - 1];
    if (lastClient) {
      startPoint = `${lastClient.location.latitude},${lastClient.location.longitude}`;
    }
  }

  const coordinates = buildRoundTripCoordinates(route, routeOrigin);
  const aParam = coordinates.map(([lng, lat]) => `${lat},${lng}`).join(",");
  const first = coordinates[0];
  const openRouteLink = `https://maps.openrouteservice.org/directions?n1=${first[1]}&n2=${first[0]}&a=${aParam}&b=0&c=0&k1=en-US&k2=km`;

  return {
    response,
    googleMapsRouteLinks,
    openRouteLink,
  };
};

module.exports = {
  buildMissingClients,
  buildOptimizedRoute,
  buildRouteOptions,
  buildRouteArtifacts,
  buildRouteLabel,
  calculateRouteDistance,
  normalizeRequestedStops,
  normalizeWeight,
};
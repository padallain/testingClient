const ORIGIN = { latitude: 10.578208693113535, longitude: -71.67338068775426 };
const START_ID = "317554345";
const MAX_WAYPOINTS = 10;

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

const normalizeWeight = (value) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return 0;
  }

  return numericValue;
};

const buildRouteLabel = (driverId, requestedLabel) => {
  const normalizedLabel = typeof requestedLabel === "string" ? requestedLabel.trim() : "";

  if (normalizedLabel) {
    return normalizedLabel;
  }

  const dateTag = new Date().toISOString().slice(0, 10);
  return `Ruta ${driverId} ${dateTag}`;
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

    if (!clientId) {
      return;
    }

    if (aggregatedStops.has(clientId)) {
      duplicateClientIds.push(clientId);
      return;
    }

    aggregatedStops.set(clientId, { clientId });
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

const getClientsWithCoordinates = (clients) => clients.filter(
  (client) =>
    client.location && Number.isFinite(client.location.latitude) && Number.isFinite(client.location.longitude),
);

const splitStartClient = (clients) => {
  const startClientIndex = clients.findIndex((client) => client.id === START_ID);
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

const buildGreedyRoute = (clients, pickFarthest = false) => {
  const clientsWithCoordinates = getClientsWithCoordinates(clients);

  if (clientsWithCoordinates.length === 0) {
    return [];
  }

  const { startClient, restClients } = splitStartClient(clientsWithCoordinates);
  const route = [];
  let currentPoint = startClient ? { ...startClient } : { location: ORIGIN };

  if (startClient) {
    route.push(currentPoint);
  }

  const unvisited = [...restClients];

  while (unvisited.length > 0) {
    let targetIdx = 0;
    let targetDistance = calculateDistance(
      currentPoint.location.latitude,
      currentPoint.location.longitude,
      unvisited[0].location.latitude,
      unvisited[0].location.longitude,
    );

    for (let index = 1; index < unvisited.length; index += 1) {
      const distance = calculateDistance(
        currentPoint.location.latitude,
        currentPoint.location.longitude,
        unvisited[index].location.latitude,
        unvisited[index].location.longitude,
      );

      const shouldReplace = pickFarthest ? distance > targetDistance : distance < targetDistance;

      if (shouldReplace) {
        targetDistance = distance;
        targetIdx = index;
      }
    }

    currentPoint = { ...unvisited[targetIdx] };
    route.push(currentPoint);
    unvisited.splice(targetIdx, 1);
  }

  return route;
};

const buildAlphabeticalRoute = (clients) => {
  const clientsWithCoordinates = getClientsWithCoordinates(clients);

  if (clientsWithCoordinates.length === 0) {
    return [];
  }

  const { startClient, restClients } = splitStartClient(clientsWithCoordinates);
  const sortedClients = [...restClients].sort((leftClient, rightClient) => {
    const leftKey = `${String(leftClient.nombre || "").trim().toLowerCase()}-${String(leftClient.id || "")}`;
    const rightKey = `${String(rightClient.nombre || "").trim().toLowerCase()}-${String(rightClient.id || "")}`;

    return leftKey.localeCompare(rightKey, "es");
  });

  return startClient ? [{ ...startClient }, ...sortedClients] : sortedClients;
};

const calculateRouteDistance = (route) => {
  if (!Array.isArray(route) || route.length === 0) {
    return 0;
  }

  let totalDistance = 0;
  let previousPoint = ORIGIN;

  route.forEach((client) => {
    totalDistance += calculateDistance(
      previousPoint.latitude,
      previousPoint.longitude,
      client.location.latitude,
      client.location.longitude,
    );
    previousPoint = client.location;
  });

  return Number(totalDistance.toFixed(2));
};

const buildOptimizedRoute = (clients) => {
  return buildGreedyRoute(clients, false);
};

const buildRouteOptions = (clients) => {
  const optionBuilders = [
    {
      ...ROUTE_TYPE_META.closest,
      route: buildGreedyRoute(clients, false),
    },
    {
      ...ROUTE_TYPE_META.farthest,
      route: buildGreedyRoute(clients, true),
    },
    {
      ...ROUTE_TYPE_META.alphabetical,
      route: buildAlphabeticalRoute(clients),
    },
  ].filter((option) => option.route.length > 0);

  const seenSignatures = new Set();

  return optionBuilders.filter((option) => {
    const signature = option.route.map((client) => client.id).join("|");

    if (seenSignatures.has(signature)) {
      return false;
    }

    seenSignatures.add(signature);
    return true;
  }).map((option) => ({
    ...option,
    estimatedDistanceKm: calculateRouteDistance(option.route),
  }));
};

const buildRouteArtifacts = (route) => {
  const response = route.map((client) => ({
    id: client.id,
    nombre: client.nombre,
    weight: client.weight,
    location: client.location,
    googleMapsLink: `https://www.google.com/maps?q=${client.location.latitude},${client.location.longitude}`,
  }));

  const googleMapsRouteLinks = [];
  let startPoint = `${ORIGIN.latitude},${ORIGIN.longitude}`;

  for (let i = 0; i < route.length; i += MAX_WAYPOINTS - 1) {
    const segment = route.slice(i, i + (MAX_WAYPOINTS - 1));
    const waypoints = [
      startPoint,
      ...segment.map((client) => `${client.location.latitude},${client.location.longitude}`),
    ].join("/");
    googleMapsRouteLinks.push(`https://www.google.com/maps/dir/${waypoints}`);

    const lastClient = segment[segment.length - 1];
    if (lastClient) {
      startPoint = `${lastClient.location.latitude},${lastClient.location.longitude}`;
    }
  }

  const coordinates = [
    [ORIGIN.longitude, ORIGIN.latitude],
    ...route.map((client) => [client.location.longitude, client.location.latitude]),
  ];
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
  normalizeRequestedStops,
  normalizeWeight,
};
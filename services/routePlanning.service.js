const ORIGIN = { latitude: 10.578208693113535, longitude: -71.67338068775426 };
const START_ID = "317554345";
const MAX_WAYPOINTS = 10;

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

const buildOptimizedRoute = (clients) => {
  const clientsWithCoordinates = clients.filter(
    (client) =>
      client.location && Number.isFinite(client.location.latitude) && Number.isFinite(client.location.longitude),
  );

  if (clientsWithCoordinates.length === 0) {
    return [];
  }

  const startClientIndex = clientsWithCoordinates.findIndex((client) => client.id === START_ID);
  const startClient = startClientIndex !== -1 ? clientsWithCoordinates[startClientIndex] : null;
  const restClients = startClientIndex !== -1
    ? [
      ...clientsWithCoordinates.slice(0, startClientIndex),
      ...clientsWithCoordinates.slice(startClientIndex + 1),
    ]
    : clientsWithCoordinates;

  const route = [];
  let currentPoint = startClient ? { ...startClient } : { location: ORIGIN };

  if (startClient) {
    route.push(currentPoint);
  }

  const unvisited = [...restClients];

  while (unvisited.length > 0) {
    let nearestIdx = 0;
    let minDist = calculateDistance(
      currentPoint.location.latitude,
      currentPoint.location.longitude,
      unvisited[0].location.latitude,
      unvisited[0].location.longitude,
    );

    for (let i = 1; i < unvisited.length; i += 1) {
      const dist = calculateDistance(
        currentPoint.location.latitude,
        currentPoint.location.longitude,
        unvisited[i].location.latitude,
        unvisited[i].location.longitude,
      );

      if (dist < minDist) {
        minDist = dist;
        nearestIdx = i;
      }
    }

    currentPoint = { ...unvisited[nearestIdx] };
    route.push(currentPoint);
    unvisited.splice(nearestIdx, 1);
  }

  return route;
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
  buildRouteArtifacts,
  buildRouteLabel,
  normalizeRequestedStops,
  normalizeWeight,
};
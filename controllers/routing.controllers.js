const Client = require("../models/client.model"); // Asegúrate de tener un modelo para los clientes

const ORIGIN = { latitude: 10.578208693113535, longitude: -71.67338068775426 };
const START_ID = "317554345";

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

const MAX_WAYPOINTS = 10; // Google Maps permite hasta 10 puntos por link (incluyendo origen y destino)

// ...existing code...

const makeRoute = async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids)) {
      return res
        .status(400)
        .json({ message: "Invalid input, expected an array of IDs" });
    }

    const clients = await Client.find({ id: { $in: ids } });

    // IDs encontrados y no encontrados
    const foundIds = clients.map((client) => client.id);
    const notFoundIds = ids.filter((id) => !foundIds.includes(id));

    const clientsWithCoordinates = clients.filter(
      (client) =>
        client.location && client.location.latitude && client.location.longitude
    );

    if (clientsWithCoordinates.length < 1) {
      return res
        .status(400)
        .json({
          message: "At least one client with valid coordinates is required",
          notFoundIds,
        });
    }

    // Buscar y separar el cliente de inicio
    const startClientIndex = clientsWithCoordinates.findIndex(c => c.id === START_ID);
    let startClient = null;
    let restClients = clientsWithCoordinates;
    if (startClientIndex !== -1) {
      startClient = clientsWithCoordinates[startClientIndex];
      restClients = [
        ...clientsWithCoordinates.slice(0, startClientIndex),
        ...clientsWithCoordinates.slice(startClientIndex + 1)
      ];
    }

    // --- OPTIMIZACIÓN DE RUTA: NEAREST NEIGHBOR ---
    let route = [];
    let currentPoint;
    if (startClient) {
      route.push(startClient);
      currentPoint = startClient;
    } else {
      // Si no hay cliente de inicio, empieza desde el origen
      currentPoint = {
        location: ORIGIN
      };
    }

    let unvisited = [...restClients];

    while (unvisited.length > 0) {
      // Buscar el cliente más cercano al punto actual
      let nearestIdx = 0;
      let minDist = calculateDistance(
        currentPoint.location.latitude,
        currentPoint.location.longitude,
        unvisited[0].location.latitude,
        unvisited[0].location.longitude
      );
      for (let i = 1; i < unvisited.length; i++) {
        const dist = calculateDistance(
          currentPoint.location.latitude,
          currentPoint.location.longitude,
          unvisited[i].location.latitude,
          unvisited[i].location.longitude
        );
        if (dist < minDist) {
          minDist = dist;
          nearestIdx = i;
        }
      }
      // Agregar el más cercano a la ruta y actualizar el punto actual
      currentPoint = unvisited[nearestIdx];
      route.push(currentPoint);
      unvisited.splice(nearestIdx, 1);
    }

    const response = route.map((client) => ({
      id: client.id,
      nombre: client.nombre,
      location: client.location,
      googleMapsLink: `https://www.google.com/maps?q=${client.location.latitude},${client.location.longitude}`,
    }));

    // Dividir la ruta en segmentos de máximo 10 puntos, siempre comenzando desde el ORIGIN o el primer cliente
    const googleMapsRouteLinks = [];
    let startPoint = `${ORIGIN.latitude},${ORIGIN.longitude}`;
    for (let i = 0; i < route.length; i += MAX_WAYPOINTS - 1) {
      const segment = route.slice(i, i + (MAX_WAYPOINTS - 1));
      const waypoints = [
        startPoint,
        ...segment.map(
          (client) => `${client.location.latitude},${client.location.longitude}`
        ),
      ].join("/");
      googleMapsRouteLinks.push(`https://www.google.com/maps/dir/${waypoints}`);

      // El próximo segmento debe empezar donde terminó este
      const lastClient = segment[segment.length - 1];
      if (lastClient) {
        startPoint = `${lastClient.location.latitude},${lastClient.location.longitude}`;
      }
    }

    // --- LINK DE OPENROUTESERVICE ---
    // Construir el link para el visor de OpenRouteService
    // Formato: ...&a=lat1,lng1,lat2,lng2,lat3,lng3...
    const coordinates = [
      [ORIGIN.longitude, ORIGIN.latitude], // ORIGEN
      ...route.map(client => [client.location.longitude, client.location.latitude])
    ];
    const aParam = coordinates
      .map(([lng, lat]) => `${lat},${lng}`)
      .join(',');
    const first = coordinates[0];
    const openRouteLink = `https://maps.openrouteservice.org/directions?n1=${first[1]}&n2=${first[0]}&a=${aParam}&b=0&c=0&k1=en-US&k2=km`;

    res.status(200).json({
      route: response,
      routeNames: response.map((client) => client.nombre),
      googleMapsRouteLinks,
      openRouteLink,
      notFoundIds,
    });
  } catch (err) {
    console.log("Error al calcular la ruta logística:", err);
    res.status(500).json({ message: "Error calculating route" });
  }
};

// ...existing code...

module.exports = {
  makeRoute,
};

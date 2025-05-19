const Client = require("../models/client.model"); // Asegúrate de tener un modelo para los clientes

// Función para calcular la distancia entre dos puntos geográficos usando la fórmula de Haversine
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const toRadians = (degrees) => degrees * (Math.PI / 180);
  const R = 6371; // Radio de la Tierra en kilómetros
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distancia en kilómetros
};

const makeRoute = async (req, res) => {
  try {
    const { ids } = req.body; // Suponiendo que envías un array de IDs en el cuerpo de la solicitud

    if (!Array.isArray(ids)) {
      return res.status(400).json({ message: 'Invalid input, expected an array of IDs' });
    }

    // Buscar los clientes en la base de datos por sus IDs
    const clients = await Client.find({ id: { $in: ids } });

    if (clients.length === 0) {
      return res.status(404).json({ message: 'No clients found' });
    }

    // Verificar que todos los clientes tengan coordenadas válidas
    const clientsWithCoordinates = clients.filter(client => 
      client.location && client.location.latitude && client.location.longitude
    );

    if (clientsWithCoordinates.length < 2) {
      return res.status(400).json({ message: 'At least two clients with valid coordinates are required' });
    }

    // Crear una matriz de distancias entre los clientes
    const distances = [];
    for (let i = 0; i < clientsWithCoordinates.length; i++) {
      const row = [];
      for (let j = 0; j < clientsWithCoordinates.length; j++) {
        if (i === j) {
          row.push(0); // Distancia a sí mismo es 0
        } else {
          const distance = calculateDistance(
            clientsWithCoordinates[i].location.latitude,
            clientsWithCoordinates[i].location.longitude,
            clientsWithCoordinates[j].location.latitude,
            clientsWithCoordinates[j].location.longitude
          );
          row.push(distance);
        }
      }
      distances.push(row);
    }

    // Implementar un algoritmo simple de Nearest Neighbor para calcular la ruta
    const visited = new Set();
    const route = [];
    let currentIndex = 0;

    while (visited.size < clientsWithCoordinates.length) {
      visited.add(currentIndex);
      route.push(clientsWithCoordinates[currentIndex]);

      let nearestIndex = -1;
      let nearestDistance = Infinity;

      for (let i = 0; i < distances[currentIndex].length; i++) {
        if (!visited.has(i) && distances[currentIndex][i] < nearestDistance) {
          nearestDistance = distances[currentIndex][i];
          nearestIndex = i;
        }
      }

      currentIndex = nearestIndex;
    }

    // Construir la respuesta con la ruta optimizada
    const response = route.map(client => ({
      id: client.id,
      nombre: client.nombre,
      location: client.location,
      googleMapsLink: `https://www.google.com/maps?q=${client.location.latitude},${client.location.longitude}`,
    }));

    // Responder con la ruta optimizada
    res.status(200).json(response);
  } catch (err) {
    console.log("Error al calcular la ruta logística:", err);
    res.status(500).json({ message: 'Error calculating route' });
  }
};

module.exports = {
  makeRoute,
};
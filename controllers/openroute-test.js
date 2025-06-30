const axios = require('axios');

// Reemplaza con tu API KEY de OpenRouteService
const apiKey = '5b3ce3597851110001cf6248f09ed52b9ad144e7ad570d4ee49343d7';

// Coordenadas de ejemplo: [longitud, latitud]
const coordinates = [
  [-71.67338068775426, 10.578208693113535], // ORIGEN
  [-71.6811406, 10.6879963], // Parada 1
  [-71.6792704, 10.7050433], // Parada 2
  [-71.6794345, 10.6892531], // Parada 3
  // ...agrega más paradas aquí
];

async function getRoute() {
  try {
    const response = await axios.post(
      'https://api.openrouteservice.org/v2/directions/driving-car/geojson',
      { coordinates },
      {
        headers: {
          Authorization: apiKey,
          'Content-Type': 'application/json',
        },
      }
    );

    // Muestra la distancia total y duración
    const summary = response.data.features[0].properties.summary;
    console.log('Distancia total (m):', summary.distance);
    console.log('Duración total (s):', summary.duration);

    // Construir el link para el visor de OpenRouteService
    // Formato: ...&a=lat1,lng1,lat2,lng2,lat3,lng3...
    const aParam = coordinates
      .map(([lng, lat]) => `${lat},${lng}`)
      .join(',');

    const first = coordinates[0];
    const mapLink = `https://maps.openrouteservice.org/directions?n1=${first[1]}&n2=${first[0]}&a=${aParam}&b=0&c=0&k1=en-US&k2=km`;

    console.log('Ver ruta en OpenRouteService:', mapLink);

    // Si quieres ver toda la respuesta GeoJSON:
    // console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('Error obteniendo la ruta:', error.response ? error.response.data : error.message);
  }
}

getRoute();
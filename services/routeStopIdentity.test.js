const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeRouteStops, normalizeDriverRoute } = require('./routeStopIdentity.service');

const ojeda = { clientId: '070201525', nombre: 'Viveres De candido (OJEDA)',
  location: { latitude: 10.2, longitude: -71.25 }, dispatched: false };

test('Tres copias de OJEDA se consolidan sin modificar los pedidos', () => {
  const route = { stops: [{ ...ojeda, order: 14 }, { ...ojeda, order: 16 }, { ...ojeda, order: 17 }],
    loadGuide: { orders: [{ total: 100 }, { total: 200 }, { total: 300 }] } };
  const normalized = normalizeDriverRoute(route);
  assert.equal(normalized.stops.length, 1);
  assert.equal(normalized.stops[0].order, 1);
  assert.equal(normalized.loadGuide.orders.length, 3);
  assert.equal(route.stops.length, 3);
});
test('Sedes distintas y ubicaciones antiguas distintas nunca se eliminan', () => {
  const normalized = normalizeRouteStops([{ ...ojeda, sucursal: 'Norte' }, { ...ojeda, sucursal: 'Sur' },
    ojeda, { ...ojeda, location: { latitude: 10.3, longitude: -71.25 } }]);
  assert.equal(normalized.length, 4);
  assert.equal(new Set(normalized.map(stop => stop.stopKey)).size, 4);
});
test('Ordenar no cambia las identidades ni marca entregas que no fueron confirmadas', () => {
  const normalized = normalizeRouteStops([{ ...ojeda, dispatched: true }, ojeda]);
  assert.equal(normalized[0].dispatched, false);
  assert.equal(normalized[0].dispatchedAt, null);
  const stops = normalizeRouteStops([{ ...ojeda, sucursal: 'Norte' }, { ...ojeda, sucursal: 'Sur' }]);
  assert.deepEqual(normalizeRouteStops([...stops].reverse()).map(stop => stop.stopKey), [...stops].reverse().map(stop => stop.stopKey));
});

test('Una sede declarada sigue siendo una parada aunque cambien coordenadas', () => {
  const normalized = normalizeRouteStops([{ ...ojeda, sucursal: 'OJEDA' },
    { ...ojeda, sucursal: 'OJEDA', location: { latitude: 10.21, longitude: -71.25 } }]);
  assert.equal(normalized.length, 1);
  const legacy = normalizeDriverRoute({ stops: [ojeda, { ...ojeda, location: { latitude: 10.21, longitude: -71.25 } }],
    loadGuide: { orders: [{ clientId: ojeda.clientId, sucursal: 'OJEDA' }] } });
  assert.equal(legacy.stops.length, 1);
  assert.equal(legacy.stops[0].sucursal, 'OJEDA');
});
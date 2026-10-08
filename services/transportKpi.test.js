const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultConfiguration, calculateTrip, compareTrip, aggregateTrips } = require('./transportKpi.service');

const config = defaultConfiguration();
const trip = (overrides = {}) => ({ date: '2026-10-05', freightType: 'interno', vehicleTypeId: 'camion',
  km: 200, loadedAmount: 5079, returnedAmount: 0, allowances: 0, ...overrides });

test('Camion 200 km: costo 101.57 y minimo 5078.50', () => {
  const result = calculateTrip(trip(), config);
  assert.equal(result.cost, 101.57);
  assert.equal(result.minimumSales, 5078.5);
  assert.equal(Number((result.freightRatio * 100).toFixed(1)), 2);
  assert.equal(result.semaphore, 'amarillo');
});
test('Camion 100 km y L300 70 km', () => {
  const result = calculateTrip(trip({ km: 100 }), config);
  assert.equal(result.cost, 71.8);
  assert.equal(result.minimumSales, 3590);
  assert.equal(calculateTrip(trip({ vehicleTypeId: 'l300', km: 70 }), config).cost, 51.8);
});
test('Externo fijo 170 y venta 8500', () => {
  const result = calculateTrip(trip({ freightType: 'externo', carrierId: 'maracaibo', loadedAmount: 8500 }), config);
  assert.equal(result.cost, 170);
  assert.equal(result.freightRatio, .02);
  assert.equal(result.minimumSales, 8500);
});
test('Externo 2.5%, comparacion y equilibrio', () => {
  const value = trip({ freightType: 'externo', carrierId: 'cabimas', loadedAmount: 8000, comparisonVehicleTypeId: 'camion' });
  assert.equal(calculateTrip(value, config).cost, 200);
  const comparison = compareTrip(value, config);
  assert.equal(comparison.internalCost, 101.57);
  assert.equal(comparison.saving, 98.43);
  assert.equal(comparison.breakEvenSales, 4062.8);
});
test('Minimo 60 y bases cargado/entregado', () => {
  const tariff = { mode: 'porcentaje', percentage: .025, minimum: 60, base: 'entregado' };
  const value = trip({ freightType: 'externo', tariff, loadedAmount: 2000 });
  assert.equal(calculateTrip(value, config).cost, 60);
  assert.equal(calculateTrip({ ...value, loadedAmount: 10000, returnedAmount: 2000 }, config).cost, 200);
  assert.equal(calculateTrip({ ...value, loadedAmount: 10000, returnedAmount: 2000, tariff: { ...tariff, base: 'cargado' } }, config).cost, 250);
});
test('Venta cero, datos incompletos y parametros desconocidos', () => {
  const result = calculateTrip(trip({ loadedAmount: 0 }), config);
  assert.equal(result.freightRatio, null);
  assert.equal(result.semaphore, 'rojo');
  assert.equal(calculateTrip(trip({ returnedAmount: null }), config).semaphore, 'incompleto');
  assert.equal(calculateTrip(trip({ vehicleTypeId: 'canter' }), config).cost, null);
});
test('Agregados ponderados y suma de sobrecostos positivos', () => {
  const values = [trip({ freightType: 'externo', carrierId: 'maracaibo', loadedAmount: 10000 }),
    trip({ freightType: 'externo', carrierId: 'maracaibo', loadedAmount: 1000 })];
  const [result] = aggregateTrips(values.map((value) => ({ trip: value, metrics: calculateTrip(value, config) })));
  assert.equal(result.weightedRatio, 340 / 11000);
  assert.equal(result.excessTotal, 150);
  assert.equal(result.redTripRatio, .5);
});
test('Horas Caracas, cruce de medianoche y combustible cargado', () => {
  const result = calculateTrip(trip({ departureAt: '2026-10-05T23:00:00-04:00', returnAt: '2026-10-06T09:00:00-04:00', fuelLiters: 100 }), config);
  assert.equal(result.hours, 10);
  assert.ok(result.alerts.includes('Salida tardia.'));
  assert.ok(result.fuelDifference > .15);
});

test('Configuracion editable, historial, devoluciones y fechas', () => {
  const { normalizeConfiguration, normalizeTrip, normalizeTariff } = require('./transportData.service');
  const editable = defaultConfiguration();
  editable.vehicles.push({ id: 'test', name: 'Vehiculo de prueba', vehicleTypeId: 'camion', capacityKg: 5000, capacityPackages: null });
  const clean = normalizeConfiguration(editable);
  const route = { _id: '507f1f77bcf86cd799439011', routeLabel: 'TEST', driverId: 'TEST', loadGuide: { number: 'TEST', orders: [{ total: 5079 }] }, stops: [{ dispatched: true }] };
  const input = { ...trip(), vehicleId: 'test', zone: 'Maracaibo', routeCode: 'TEST', status: 'closed' };
  const closed = normalizeTrip(input, route, clean);
  assert.equal(closed.metricsSnapshot.cost, 101.57);
  clean.vehicleTypes[1].fuelPrice = 10;
  assert.equal(calculateTrip(closed, closed.configurationSnapshot).cost, 101.57);
  assert.throws(() => normalizeTrip({}, route, clean, closed), /cerrado/);
  assert.throws(() => normalizeTrip({ ...input, returnedAmount: 10000 }, route, clean), /supera/);
  assert.throws(() => normalizeTrip({ ...input, date: '2026-02-30' }, route, clean), /invalida/);
  assert.throws(() => normalizeTrip({ ...input, departureAt: '2026-10-05T08:00' }, route, clean), /zona horaria/);
  assert.equal(normalizeTariff({ mode: 'fijo', fixed: 190, percentage: 0, minimum: 0, base: 'entregado' }).fixed, 190);
});

test('Excel semanal valido con semaforo, datos de soporte y Arial', async () => {
  const { buildWeeklyWorkbook } = require('./transportExcel.service');
  const Excel = require('exceljs');
  const value = trip({ guideNumber: 'EJEMPLO', vehicleId: 'TEST' });
  const records = [{ trip: value, metrics: calculateTrip(value, config) }];
  const workbook = await buildWeeklyWorkbook(records, aggregateTrips(records), config);
  const buffer = await workbook.xlsx.writeBuffer();
  const reread = new Excel.Workbook();
  await reread.xlsx.load(buffer);
  assert.equal(reread.getWorksheet('Viajes').getCell('J2').value, 101.57);
  assert.equal(reread.getWorksheet('Viajes').getCell('J2').font.name, 'Arial');
  assert.ok(reread.getWorksheet('Viajes').conditionalFormattings.length);
  assert.equal(reread.worksheets.length, 3);
});

test('REST: permisos, planificacion, cierre, filtros, conflictos y Excel', async (context) => {
  const express = require('express');
  const Configuration = require('../models/transportConfiguration.model');
  const TransportTrip = require('../models/transportTrip.model');
  const Route = require('../models/routeAssignment.model');
  const User = require('../models/user.model');
  const Issues = require('../models/dispatchIssueReport.model');
  const storedConfig = { ...defaultConfiguration(), version: 1 };
  storedConfig.vehicles.push({ id: 'test', name: 'Ejemplo', vehicleTypeId: 'camion', capacityKg: 5000, capacityPackages: null });
  const route = { _id: '507f1f77bcf86cd799439011', routeLabel: 'EJEMPLO', driverId: 'TEST', loadGuide: { number: 'EJEMPLO', orders: [{ total: 5079 }] }, stops: [{ dispatched: true }] };
  let storedTrip = null;
  const methods = [[Configuration, 'findOneAndUpdate'], [TransportTrip, 'findOne'], [TransportTrip, 'create'],
    [TransportTrip, 'findOneAndUpdate'], [TransportTrip, 'countDocuments'], [TransportTrip, 'find'], [Route, 'findById'], [User, 'findById'],
    [Route, 'findOneAndUpdate'], [Issues, 'find'], [Route, 'find']];
  const originals = methods.map(([model, method]) => model[method]);
  context.after(() => methods.forEach(([model, method], index) => { model[method] = originals[index]; }));
  Configuration.findOneAndUpdate = (query, update) => ({ lean: async () => {
    if (query.version != null && query.version !== storedConfig.version) return null;
    if (update.$set) Object.assign(storedConfig, update.$set, { version: storedConfig.version + 1 });
    return structuredClone(storedConfig);
  } });
  TransportTrip.findOne = () => ({ lean: async () => storedTrip && structuredClone(storedTrip) });
  TransportTrip.create = async data => { storedTrip = { ...data, _id: route._id, updatedAt: new Date().toISOString() }; return { toObject: () => structuredClone(storedTrip) }; };
  TransportTrip.findOneAndUpdate = (query, update) => ({ lean: async () => {
    if (!storedTrip || storedTrip.status !== query.status || String(storedTrip.updatedAt) !== String(query.updatedAt)) return null;
    storedTrip = { ...storedTrip, ...update.$set, updatedAt: new Date(Date.now() + 1000).toISOString() };
    return structuredClone(storedTrip);
  } });
  TransportTrip.countDocuments = async () => storedTrip ? 1 : 0;
  TransportTrip.find = () => ({ sort: () => ({ lean: async () => storedTrip ? [structuredClone(storedTrip)] : [] }),
    select: () => ({ lean: async () => storedTrip ? [structuredClone(storedTrip)] : [] }) });
  Route.findById = id => ({ lean: async () => id === route._id ? structuredClone(route) : null });
  let failCompletion = false;
  let issues = [];
  Route.findOneAndUpdate = (_query, update) => ({ lean: async () => { if (failCompletion) throw new Error('Prueba de fallo'); Object.assign(route, update.$set); return structuredClone(route); } });
  Route.find = () => ({ sort: () => ({ limit: () => ({ select: () => ({ lean: async () => [structuredClone(route)] }) }) }) });
  Issues.find = () => ({ lean: async () => structuredClone(issues) });
  User.findById = async role => ({ _id: role, username: 'Prueba', email: 'test@example.invalid', role, isApproved: true, approvalRequired: false });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { if (req.headers['x-test-role']) req.session = { user: { id: req.headers['x-test-role'] } }; next(); });
  app.use('/transport-kpis', require('../routes/transport.routes'));
  const server = await new Promise(resolve => { const running = app.listen(0, '127.0.0.1', () => resolve(running)); });
  context.after(() => { server.closeAllConnections(); server.close(); });
  const request = (path, body, role = 'admin', method = body ? 'POST' : 'GET') => fetch(`http://127.0.0.1:${server.address().port}/transport-kpis${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(role ? { 'x-test-role': role } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  assert.equal((await request('/configuration', null, '')).status, 401);
  assert.equal((await request('/configuration', null, 'chofer')).status, 403);
  assert.equal((await request('/configuration')).status, 200);
  const planning = await (await request('/planning', { freightType: 'externo', carrierId: 'maracaibo', km: 200, loadedAmount: 8500, allowances: 0,
    tariff: { mode: 'fijo', fixed: 190, percentage: 0, minimum: 0, base: 'entregado' } })).json();
  assert.equal(planning.metrics.cost, 190);
  const input = { date: '2026-10-05', vehicleId: 'test', zone: 'Maracaibo', routeCode: 'R1', freightType: 'interno', km: 200, allowances: 0, returnedAmount: 0, status: 'draft' };
  const saved = await (await request(`/trips/${route._id}`, input, 'admin', 'PATCH')).json();
  assert.equal(saved.metrics.cost, 101.57);
  route.loadGuide.orders.push({ total: 100 });
  const refreshedDraft = await (await request(`/guides/${route._id}`)).json();
  assert.equal(refreshedDraft.trip.loadedAmount, 5179);
  assert.equal(refreshedDraft.trip.guideSnapshot.orders.length, 2);
  assert.equal(refreshedDraft.trip.updatedAt, saved.trip.updatedAt);
  route.loadGuide.orders.pop();
  assert.equal((await request(`/trips/${route._id}`, { ...input, updatedAt: '2000-01-01' }, 'admin', 'PATCH')).status, 409);
  const closed = await (await request(`/trips/${route._id}`, { ...input, status: 'closed', updatedAt: saved.trip.updatedAt }, 'admin', 'PATCH')).json();
  assert.equal(closed.trip.status, 'closed');
  storedConfig.vehicleTypes[1].fuelPrice = 10;
  const historical = await (await request(`/guides/${route._id}`)).json();
  assert.equal(historical.metrics.cost, 101.57);
  assert.equal((await request(`/trips/${route._id}`, input, 'admin', 'PATCH')).status, 409);
  assert.equal((await request('/aggregates?period=wrong')).status, 400);
  assert.equal((await request('/guides?from=2026-02-30')).status, 400);
  assert.equal((await request('/guides/not-an-id')).status, 400);
  const aggregate = await (await request('/aggregates?period=week&groupBy=vehicleId')).json();
  assert.equal(aggregate.groups[0].costTotal, 101.57);
  const excel = await request('/weekly.xlsx?from=2026-10-05&to=2026-10-11');
  assert.equal(excel.status, 200);
  assert.ok(excel.headers.get('content-type').includes('spreadsheetml'));
  assert.ok((await excel.arrayBuffer()).byteLength > 1000);
  assert.equal((await request('/weekly.xlsx?from=2026-10-01&to=2026-10-30')).status, 400);
  const finished = await (await request(`/trips/${route._id}/finish`, {})).json();
  assert.equal(finished.route.status, 'completed');
  assert.equal(finished.metrics.cost, 101.57);
  assert.equal((await request(`/trips/${route._id}/finish`, { returnedAmount: 100 })).status, 409);
  const completeExport = await request(`/trips/${route._id}/export`);
  assert.equal(completeExport.status, 200);
  const Excel = require('exceljs');
  const book = new Excel.Workbook();
  await book.xlsx.load(Buffer.from(await completeExport.arrayBuffer()));
  assert.ok(book.getWorksheet('Pedidos'));
  assert.ok(book.getWorksheet('Devoluciones'));
  assert.ok(book.getWorksheet('Paradas al liquidar'));
  const jsonExport = await (await request(`/trips/${route._id}/export?format=json`)).json();
  assert.equal(jsonExport.currentRouteStatus, 'completed');
  assert.equal(jsonExport.trip.metricsSnapshot.cost, 101.57);
  assert.equal((await request('/routes-to-finish', null, 'chofer')).status, 403);
  const listing = await (await request('/routes-to-finish?status=all')).json();
  assert.equal(listing.routes[0].trip.status, 'closed');
  storedTrip = null;
  route.status = 'active';
  const times = { departureAt: '2026-10-05T08:00:00-04:00', returnAt: '2026-10-05T16:00:00-04:00' };
  const delivery = { ...input, ...times, deliveryOutcome: 'con_devoluciones', returnedAmount: 79,
    returns: [{ orderIndex: 0, amount: 79, reason: 'Rechazado' }] };
  issues = [{ routeId: route._id, orderNumber: 'TEST', clientId: 'CLIENTE', items: [{ productId: 'P1', novelty: 'Rechazo', quantity: 1 }] }];
  assert.equal((await request(`/trips/${route._id}/finish`, { ...delivery, returnedAmount: 80 })).status, 400);
  const withReturns = await (await request(`/trips/${route._id}/finish`, delivery)).json();
  assert.equal(withReturns.route.status, 'completed');
  assert.equal(withReturns.trip.deliveryOutcome, 'con_devoluciones');
  assert.equal(withReturns.metrics.netSales, 5000);
  assert.equal(withReturns.trip.settledBy.id, 'admin');
  issues = [];
  const frozen = await (await request(`/trips/${route._id}/export?format=json`)).json();
  assert.equal(frozen.issues.length, 1);
  assert.equal(frozen.trip.returns[0].amount, 79);
  storedTrip = null;
  route.status = 'active';
  failCompletion = true;
  const cleanDelivery = { ...input, ...times, deliveryOutcome: 'sin_novedad', returnedAmount: 0, plannedStops: 1, attendedStops: 1 };
  assert.equal((await request(`/trips/${route._id}/finish`, cleanDelivery)).status, 503);
  assert.equal(storedTrip.status, 'closed');
  const settledAt = storedTrip.closedAt;
  failCompletion = false;
  const retried = await (await request(`/trips/${route._id}/finish`, {})).json();
  assert.equal(retried.route.status, 'completed');
  assert.equal(new Date(retried.trip.closedAt).getTime(), new Date(settledAt).getTime());
});

test('Limites exactos, margen editable y alertas sin falsos positivos', () => {
  const external = fixed => trip({ freightType: 'externo', loadedAmount: 10000, tariff: { mode: 'fijo', fixed, base: 'entregado' } });
  assert.equal(calculateTrip(external(149.99), config).semaphore, 'verde');
  assert.equal(calculateTrip(external(150), config).semaphore, 'amarillo');
  assert.equal(calculateTrip(external(200), config).semaphore, 'amarillo');
  assert.equal(calculateTrip(external(200.01), config).semaphore, 'rojo');
  const differentMargin = { ...config, settings: { ...config.settings, grossMargin: .05 } };
  assert.equal(calculateTrip(trip(), differentMargin).estimatedProfit, 152.38);
  const exactFuel = calculateTrip(trip({ km: 318.75, fuelLiters: 100 }), config);
  assert.equal(exactFuel.fuelDifference, .15);
  assert.ok(!exactFuel.alerts.some(alert => alert.includes('Km/l cargado bajo')));
  assert.ok(calculateTrip(trip({ departureAt: '2026-10-05T08:00:01-04:00' }), config).alerts.includes('Salida tardia.'));
});

test('Liquidacion: sin novedad y devoluciones verificadas por pedido', () => {
  const { normalizeSettlement } = require('./transportSettlement.service');
  const guide = { orders: [{ orderNumber: 'PEDIDO-1', clientId: 'CLIENTE-1', total: 500 }] };
  const clean = { deliveryOutcome: 'sin_novedad', returnedAmount: 0, plannedStops: 1, attendedStops: 1, loadedKg: 100, deliveredKg: 100 };
  assert.equal(normalizeSettlement(clean, guide).returns.length, 0);
  assert.throws(() => normalizeSettlement({ ...clean, attendedStops: 0 }, guide), /paradas/);
  const partial = { deliveryOutcome: 'con_devoluciones', returnedAmount: 50,
    returns: [{ orderIndex: 0, amount: 50, reason: 'Rechazado por cliente', kg: 10 }] };
  assert.equal(normalizeSettlement(partial, guide).returns[0].orderNumber, 'PEDIDO-1');
  assert.throws(() => normalizeSettlement({ ...partial, returnedAmount: 40 }, guide), /no coincide/);
  assert.throws(() => normalizeSettlement({ ...partial, returnedAmount: 600, returns: [{ ...partial.returns[0], amount: 600 }] }, guide), /supera/);
  assert.throws(() => normalizeSettlement({ ...partial, returns: [{ ...partial.returns[0], reason: '' }] }, guide), /motivo/);
  assert.throws(() => normalizeSettlement({ ...partial, loadedKg: 100, deliveredKg: 95 }, guide), /superan la carga/);
});

test('Planificacion se guarda sin datos finales ni convierte estimados en reales', () => {
  const { normalizeTrip } = require('./transportData.service');
  const configuration = defaultConfiguration();
  configuration.vehicles.push({ id: 'PLAN', name: 'Vehiculo de prueba', vehicleTypeId: 'camion', capacityKg: 5000, capacityPackages: null });
  const route = { _id: '507f1f77bcf86cd799439041', driverId: 'PRUEBA', routeLabel: 'PLAN', totalWeight: 100,
    loadGuide: { number: 'PLAN', orders: [{ total: 5079 }] }, stops: [{ dispatched: true }] };
  const beforeDeparture = { date: '2026-10-06', vehicleId: 'PLAN', zone: 'Maracaibo', routeCode: 'PLAN', freightType: 'interno',
    status: 'draft', estimatedKm: 200, estimatedAllowances: 5 };
  const draft = normalizeTrip(beforeDeparture, route, configuration);
  assert.equal(draft.estimatedKm, 200);
  assert.equal(draft.estimatedAllowances, 5);
  for (const key of ['km', 'allowances', 'returnedAmount', 'deliveredKg', 'deliveredPackages', 'attendedStops', 'fuelLiters', 'departureAt', 'returnAt']) assert.equal(draft[key], null);
  assert.equal(calculateTrip(draft, configuration).cost, null);
  assert.equal(calculateTrip(draft, configuration).semaphore, 'incompleto');
  assert.throws(() => normalizeTrip({ ...beforeDeparture, status: 'closed' }, route, configuration), /Para cerrar/);
  const updated = normalizeTrip({ ...beforeDeparture, estimatedKm: 250 }, route, configuration,
    { ...draft, km: 195, allowances: 7, returnedAmount: 79, attendedStops: 1 });
  assert.equal(updated.estimatedKm, 250);
  assert.equal(updated.km, 195);
  assert.equal(updated.allowances, 7);
  assert.equal(updated.returnedAmount, 79);
  const closed = normalizeTrip({ ...beforeDeparture, status: 'closed', km: 200, allowances: 0, returnedAmount: 0 }, route, configuration);
  assert.equal(closed.metricsSnapshot.cost, 101.57);
});

test('Estatus de despacho anuncia guia editable solo cuando existe', () => {
  const { buildRouteDispatchStatusSummary } = require('./routeStatus.service');
  const base = { _id: 'ruta-test', stops: [], missingClients: [], uniqueClientCount: 0 };
  assert.equal(buildRouteDispatchStatusSummary(base).hasLoadGuide, false);
  assert.equal(buildRouteDispatchStatusSummary({ ...base, loadGuide: { orders: [{ total: 10 }] } }).hasLoadGuide, true);
  assert.equal(buildRouteDispatchStatusSummary({ ...base, loadGuide: { orders: [] } }).hasLoadGuide, false);
});
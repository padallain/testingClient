const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeLoadGuide } = require('./loadGuideService');

const companies = [{ _id: '507f1f77bcf86cd799439011', name: 'Empresa A' }, { _id: '507f1f77bcf86cd799439012', name: 'Empresa B' }];
const stops = [{ clientId: 'CLIENTE' }];
const order = { clientId: 'CLIENTE', orderNumber: 'PEDIDO-1', date: '2026-10-06', total: 100 };
const options = { companies, defaultCompanyId: companies[0]._id, requireCompany: true };

test('Empresa predeterminada y nombre historico calculado por el backend', () => {
  const result = normalizeLoadGuide({ orders: [{ ...order, companyName: 'Nombre enviado no confiable' }] }, stops, options);
  assert.equal(result.orders[0].companyId, companies[0]._id);
  assert.equal(result.orders[0].companyName, 'Empresa A');
  companies[0].name = 'Empresa A actualizada';
  assert.equal(result.orders[0].companyName, 'Empresa A');
  companies[0].name = 'Empresa A';
});
test('Guia mixta: mismo documento en empresas diferentes', () => {
  const result = normalizeLoadGuide({ orders: [
    { ...order, companyId: companies[0]._id }, { ...order, companyId: companies[1]._id },
  ] }, stops, options);
  assert.equal(result.totalAmount, 200);
  assert.equal(result.orders.length, 2);
  assert.throws(() => normalizeLoadGuide({ orders: [order, order] }, stops, options), /repetido/);
});
test('No admite empresas inexistentes ni pedidos nuevos sin empresa', () => {
  assert.throws(() => normalizeLoadGuide({ orders: [{ ...order, companyId: 'inexistente' }] }, stops, options), /registrada/);
  assert.throws(() => normalizeLoadGuide({ orders: [order] }, stops, { companies, requireCompany: true }), /registrada/);
});
test('Compatibilidad del normalizador y rutas sin guia', () => {
  assert.equal(normalizeLoadGuide(null, stops, options), null);
  const legacy = normalizeLoadGuide({ orders: [order] }, stops);
  assert.equal(legacy.orders[0].companyId, undefined);
  assert.equal(legacy.totalAmount, 100);
});

test('REST: empresas persistidas, default y guia mixta en makeRoute', async context => {
  const express = require('express');
  const Company = require('../models/dispatchCompany.model');
  const Settings = require('../models/dispatchCompanySettings.model');
  const User = require('../models/user.model');
  const Client = require('../models/client.model');
  const Assignment = require('../models/routeAssignment.model');
  const planning = require('./routePlanning.service');
  const Trips = require('../models/transportTrip.model');
  const catalog = [];
  let selectedDefault = null;
  let savedAssignment;
  const methods = [[Company, 'find'], [Company, 'create'], [Company, 'findById'], [Settings, 'findById'],
    [Settings, 'findByIdAndUpdate'], [User, 'findById'], [Client, 'find'], [Assignment.prototype, 'save'], [planning, 'buildRouteOptions'],
    [Assignment, 'findById'], [Assignment, 'findOneAndUpdate'], [Trips, 'findOne'], [planning, 'calculateRouteDistance']];
  const originals = methods.map(([object, method]) => object[method]);
  context.after(() => methods.forEach(([object, method], index) => { object[method] = originals[index]; }));
  Company.find = () => ({ sort: () => ({ lean: async () => structuredClone(catalog) }) });
  Company.create = async data => {
    if (catalog.some(item => item.normalizedName === data.normalizedName)) { const error = new Error('Duplicado'); error.code = 11000; throw error; }
    const item = { ...data, _id: catalog.length ? companies[1]._id : companies[0]._id };
    catalog.push(item);
    return { ...item, toObject: () => structuredClone(item) };
  };
  Company.findById = id => ({ lean: async () => catalog.find(item => item._id === id) || null });
  Settings.findById = () => ({ lean: async () => selectedDefault ? { defaultCompanyId: selectedDefault } : null });
  Settings.findByIdAndUpdate = async (_id, update) => { if (update.$set) selectedDefault = update.$set.defaultCompanyId;
    else if (!selectedDefault) selectedDefault = update.$setOnInsert.defaultCompanyId; return { defaultCompanyId: selectedDefault }; };
  User.findById = async role => ({ _id: role, username: 'Prueba', email: 'test@example.invalid', role, isApproved: true, approvalRequired: false });
  const client = { id: 'CLIENTE', nombre: 'Cliente de prueba', location: { latitude: 10.65, longitude: -71.63 } };
  let currentClients = [client];
  let createdCount = 0;
  let tripStatus = 'draft';
  Client.find = query => ({ lean: async () => query.id ? currentClients.filter(item => item.id === query.id
    && (!Object.prototype.hasOwnProperty.call(query, 'sucursal') || item.sucursal === query.sucursal)) : currentClients });
  planning.buildRouteOptions = async (_clients, options = {}) => {
    const anchor = currentClients.find(item => options.anchorStopKey === (item.sucursal ? `${item.id}|${item.sucursal}` : item.id));
    return [{ type: 'closest', label: 'Mas cercana', estimatedDistanceKm: 5,
      route: anchor ? [anchor, ...currentClients.filter(item => item !== anchor)] : currentClients }];
  };
  Assignment.prototype.save = async function () { if (!savedAssignment || String(savedAssignment._id) !== String(this._id)) createdCount += 1;
    this.updatedAt = new Date(); savedAssignment = this.toObject(); return this; };
  Assignment.findById = () => ({ lean: async () => savedAssignment, then: resolve => resolve(new Assignment(savedAssignment)) });
  planning.calculateRouteDistance = async () => 10;
  Assignment.findOneAndUpdate = (query, update) => ({ lean: async () => {
    if (new Date(query.updatedAt).getTime() !== new Date(savedAssignment.updatedAt).getTime()) return null;
    savedAssignment = { ...savedAssignment, ...update.$set, updatedAt: new Date(Date.now() + 1000) };
    return savedAssignment;
  } });
  Trips.findOne = () => ({ lean: async () => ({ status: tripStatus }) });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { if (req.headers['x-test-role']) req.session = { user: { id: req.headers['x-test-role'] } }; next(); });
  app.use('/dispatch-companies', require('../routes/dispatchCompany.routes'));
  app.post('/makeRoute', require('../controllers/routing.controllers').makeRoute);
  app.post('/makeRoute/preview', require('../controllers/auth.controllers').requireAdminRole,
    (req, res) => { req.previewOnly = true; return require('../controllers/routing.controllers').makeRoute(req, res); });
  app.patch('/driver-routes/:routeId/guide', require('../controllers/auth.controllers').requireAdminRole, require('../controllers/routing.controllers').makeRoute);
  const routing = require('../controllers/routing.controllers');
  app.post('/driver-routes/:routeId/stops', routing.addStopToDriverRoute);
  app.patch('/driver-routes/:routeId/stops/:clientId/dispatch', routing.updateStopDispatchStatus);
  app.delete('/driver-routes/:routeId/stops/:clientId', routing.removeStopFromDriverRoute);
  app.patch('/driver-routes/:routeId/customize', routing.customizeDriverRoute);
  app.post('/driver-routes/:routeId/customize/preview', routing.previewDriverRouteCustomization);
  const server = await new Promise(resolve => { const running = app.listen(0, '127.0.0.1', () => resolve(running)); });
  context.after(() => { server.closeAllConnections(); server.close(); });
  const request = (path, body, role = 'admin', method = body ? 'POST' : 'GET') => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(role ? { 'x-test-role': role } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  assert.equal((await request('/dispatch-companies', null, '')).status, 401);
  assert.equal((await request('/dispatch-companies', null, 'chofer')).status, 403);
  assert.equal((await request('/dispatch-companies', { name: '   ' })).status, 400);
  const first = await (await request('/dispatch-companies', { name: 'Empresa A' })).json();
  assert.equal(first.defaultCompanyId, companies[0]._id);
  await request('/dispatch-companies', { name: 'Empresa B' });
  assert.equal((await request('/dispatch-companies', { name: ' empresa   a ' })).status, 409);
  const second = await (await request('/dispatch-companies/default', { companyId: companies[1]._id }, 'admin', 'PUT')).json();
  assert.equal(second.defaultCompanyId, companies[1]._id);
  const payload = { driverId: 'PRUEBA', stops, routeWeight: 100, loadGuide: { orders: [order] } };
  const result = await (await request('/makeRoute', payload)).json();
  assert.equal(result.savedRoute.loadGuide.orders[0].companyName, 'Empresa B');
  assert.equal(savedAssignment.loadGuide.orders[0].companyId, companies[1]._id);
  const mixed = { ...payload, loadGuide: { orders: [{ ...order, companyId: companies[0]._id }, { ...order, companyId: companies[1]._id }] } };
  assert.equal((await request('/makeRoute', mixed)).status, 200);
  assert.equal(savedAssignment.loadGuide.orders.length, 2);
  assert.equal((await request('/makeRoute', { ...payload, loadGuide: { orders: [{ ...order, companyId: 'unknown' }] } })).status, 400);
  const existingId = String(savedAssignment._id);
  const existingNumber = savedAssignment.loadGuide.number;
  const existingDate = savedAssignment.loadGuide.date;
  const creationsBeforeUpdate = createdCount;
  currentClients = [{ ...client, sucursal: 'Norte' }, { ...client, sucursal: 'Sur' }];
  const update = { ...payload, updatedAt: savedAssignment.updatedAt, stops: currentClients.map(item => ({ clientId: item.id, sucursal: item.sucursal })),
    loadGuide: { orders: currentClients.map(item => ({ ...order, sucursal: item.sucursal })) } };
  const response = await request(`/driver-routes/${existingId}/guide`, update, 'admin', 'PATCH');
  assert.equal(response.status, 200);
  const updated = await response.json();
  assert.equal(String(updated.savedRoute.routeId), existingId);
  assert.equal(updated.savedRoute.loadGuide.number, existingNumber);
  assert.equal(updated.savedRoute.loadGuide.date, existingDate);
  assert.equal(updated.updated, true);
  assert.equal(createdCount, creationsBeforeUpdate);
  assert.deepEqual(updated.savedRoute.loadGuide.orders.map(item => item.sucursal), ['Norte', 'Sur']);
  assert.deepEqual(savedAssignment.stops.map(item => item.sucursal), ['Norte', 'Sur']);
  assert.equal((await request(`/driver-routes/${existingId}/guide`, update, 'chofer', 'PATCH')).status, 403);
  assert.equal((await request(`/driver-routes/${existingId}/guide`, update, 'admin', 'PATCH')).status, 409);
  tripStatus = 'closed';
  assert.equal((await request(`/driver-routes/${existingId}/guide`, { ...update, updatedAt: savedAssignment.updatedAt }, 'admin', 'PATCH')).status, 409);
  tripStatus = 'draft';
  savedAssignment.stops[0].dispatched = true;
  const progressUpdate = { ...update, updatedAt: savedAssignment.updatedAt };
  assert.equal((await request(`/driver-routes/${existingId}/guide`, progressUpdate, 'admin', 'PATCH')).status, 200);
  assert.equal(savedAssignment.stops.find(stop => stop.sucursal === 'Norte').dispatched, true);
  assert.equal(savedAssignment.stops.find(stop => stop.sucursal === 'Sur').dispatched, false);
  assert.equal((await request(`/driver-routes/${existingId}/stops/CLIENTE/dispatch`, { dispatched: false }, 'admin', 'PATCH')).status, 409);
  assert.equal((await request(`/driver-routes/${existingId}/stops/CLIENTE/dispatch`, { dispatched: true, sucursal: 'Sur' }, 'admin', 'PATCH')).status, 200);
  assert.equal(savedAssignment.stops.find(stop => stop.sucursal === 'Sur').dispatched, true);
  assert.equal((await request(`/driver-routes/${existingId}/stops/CLIENTE/dispatch`, { dispatched: false, sucursal: 'Sur' }, 'admin', 'PATCH')).status, 200);
  const reorder = { stops: [{ clientId: 'CLIENTE', sucursal: 'Sur' }, { clientId: 'CLIENTE', sucursal: 'Norte' }] };
  assert.equal((await request(`/driver-routes/${existingId}/customize`, reorder, 'admin', 'PATCH')).status, 200);
  assert.deepEqual(savedAssignment.stops.map(stop => stop.sucursal), ['Sur', 'Norte']);
  assert.equal((await request(`/driver-routes/${existingId}/stops/CLIENTE`, null, 'admin', 'DELETE')).status, 409);
  assert.equal((await request(`/driver-routes/${existingId}/stops/CLIENTE?sucursal=Sur`, null, 'admin', 'DELETE')).status, 200);
  assert.equal(savedAssignment.stops.length, 1);
  assert.equal(savedAssignment.stops[0].sucursal, 'Norte');
  assert.equal((await request(`/driver-routes/${existingId}/stops`, { clientId: 'CLIENTE' })).status, 409);
  assert.equal((await request(`/driver-routes/${existingId}/stops`, { clientId: 'CLIENTE', sucursal: 'Sur' })).status, 200);
  assert.equal((await request(`/driver-routes/${existingId}/stops`, { clientId: 'CLIENTE', sucursal: 'Sur' })).status, 409);
  assert.equal(savedAssignment.stops.length, 2);
  const priorityUpdate = { ...update, updatedAt: savedAssignment.updatedAt, preserveRouteOrder: true,
    anchorClientId: 'CLIENTE', anchorSucursal: 'Sur', anchorStopKey: 'CLIENTE|Sur' };
  const priorityResponse = await (await request(`/driver-routes/${existingId}/guide`, priorityUpdate, 'admin', 'PATCH')).json();
  assert.equal(priorityResponse.route[0].sucursal, 'Sur');
  assert.equal(savedAssignment.stops[0].sucursal, 'Sur');
  assert.equal(String(priorityResponse.savedRoute.routeId), existingId);
  const creationsBeforePreview = createdCount;
  const beforePreview = JSON.stringify(savedAssignment);
  const preview = await (await request('/makeRoute/preview', { ...priorityUpdate, anchorSucursal: 'Norte', anchorStopKey: 'CLIENTE|Norte' })).json();
  assert.equal(preview.previewOnly, true);
  assert.equal(preview.route[0].sucursal, 'Norte');
  assert.equal(preview.savedRoute, null);
  assert.equal(createdCount, creationsBeforePreview);
  assert.equal(JSON.stringify(savedAssignment), beforePreview);
  assert.equal((await request('/makeRoute/preview', { ...priorityUpdate, anchorStopKey: 'CLIENTE|No existe' })).status, 400);
  assert.equal((await request('/makeRoute/preview', priorityUpdate, 'chofer')).status, 403);
  const driverPriority = { stops: [{ clientId: 'CLIENTE', sucursal: 'Norte' }, { clientId: 'CLIENTE', sucursal: 'Sur' }],
    priorityStop: { clientId: 'CLIENTE', sucursal: 'Sur' } };
  const driverPreview = await (await request(`/driver-routes/${existingId}/customize/preview`, driverPriority)).json();
  assert.equal(driverPreview.preview.route[0].sucursal, 'Sur');
  const driverSaved = await (await request(`/driver-routes/${existingId}/customize`, driverPriority, 'admin', 'PATCH')).json();
  assert.equal(driverSaved.route.stops[0].sucursal, 'Sur');
  assert.equal(driverSaved.route.stops[1].dispatched, true);
  assert.equal(driverSaved.route.anchorSucursal, 'Sur');
  const switchPriority = await (await request(`/driver-routes/${existingId}/customize`, {
    ...driverPriority, priorityStop: { clientId: 'CLIENTE', sucursal: 'Norte' },
  }, 'admin', 'PATCH')).json();
  assert.equal(switchPriority.route.stops[0].sucursal, 'Norte');
  assert.equal(switchPriority.route.anchorSucursal, 'Norte');
  assert.equal((await request(`/driver-routes/${existingId}/customize/preview`, { ...driverPriority, priorityStop: { clientId: 'CLIENTE', sucursal: 'Inexistente' } })).status, 400);
  savedAssignment.stops.push({ ...savedAssignment.stops[0], clientId: 'VECINO', sucursal: '', nombre: 'Vecino', order: 3 });
  const manualWithPriority = { stops: [{ clientId: 'CLIENTE', sucursal: 'Sur' }, { clientId: 'VECINO', sucursal: '' }, { clientId: 'CLIENTE', sucursal: 'Norte' }],
    priorityStop: { clientId: 'CLIENTE', sucursal: 'Sur' } };
  const preserved = await (await request(`/driver-routes/${existingId}/customize`, manualWithPriority, 'admin', 'PATCH')).json();
  assert.deepEqual(preserved.route.stops.map(stop => `${stop.clientId}|${stop.sucursal}`), ['CLIENTE|Sur', 'VECINO|', 'CLIENTE|Norte']);
  const { normalizeDriverRoute } = require('./routeStopIdentity.service');
  const ojeda = { ...savedAssignment.stops[0], clientId: '070201525', sucursal: '', nombre: 'Viveres De candido (OJEDA)', dispatched: false };
  savedAssignment.stops = [ojeda, { ...ojeda }, { ...ojeda }, savedAssignment.stops[2]];
  savedAssignment.loadGuide.orders = [{ clientId: '070201525', sucursal: 'OJEDA', total: 100 },
    { clientId: '070201525', sucursal: 'OJEDA', total: 200 }, { clientId: 'CLIENTE', sucursal: 'Norte', total: 100 }];
  const display = normalizeDriverRoute(savedAssignment);
  assert.equal(display.stops.length, 2);
  const cleanedSave = await (await request(`/driver-routes/${existingId}/customize`, {
    stops: [...display.stops].reverse().map(stop => ({ clientId: stop.clientId, sucursal: stop.sucursal, stopKey: stop.stopKey })),
  }, 'admin', 'PATCH')).json();
  assert.equal(cleanedSave.route.stops.length, 2);
  assert.equal(cleanedSave.route.loadGuide.orders.length, 3);
  assert.equal(cleanedSave.route.stops[1].sucursal, 'OJEDA');
});

test('Liquidacion y Excel identifican empresas aunque el documento coincida', async () => {
  const { normalizeSettlement } = require('./transportSettlement.service');
  const { buildTripWorkbook } = require('./transportExcel.service');
  const { defaultConfiguration, calculateTrip } = require('./transportKpi.service');
  const guide = normalizeLoadGuide({ orders: [{ ...order, companyId: companies[0]._id }, { ...order, companyId: companies[1]._id }] }, stops, options);
  const settlement = normalizeSettlement({ deliveryOutcome: 'con_devoluciones', returnedAmount: 10,
    returns: [{ orderIndex: 1, amount: 10, reason: 'Rechazado' }] }, guide);
  assert.equal(settlement.returns[0].companyName, 'Empresa B');
  const configuration = defaultConfiguration();
  const trip = { ...settlement, guideSnapshot: guide, returnedAmount: 10, loadedAmount: 200, allowances: 0,
    freightType: 'externo', carrierId: 'maracaibo', date: '2026-10-06' };
  const workbook = await buildTripWorkbook({ trip, route: {}, metrics: calculateTrip(trip, configuration), issues: [], configuration });
  assert.equal(workbook.getWorksheet('Pedidos').getCell('A2').value, 'Empresa A');
  assert.equal(workbook.getWorksheet('Pedidos').getCell('A3').value, 'Empresa B');
  assert.equal(workbook.getWorksheet('Devoluciones').getCell('A2').value, 'Empresa B');
});

test('Optimizador real: la prioridad fija una sede y conserva todas las paradas', async context => {
  const axios = require('axios');
  const originalPost = axios.post;
  axios.post = async () => { throw new Error('Sin red durante la prueba'); };
  context.after(() => { axios.post = originalPost; });
  const { buildRouteOptions } = require('./routePlanning.service');
  const clients = [
    { id: 'J-PRUEBA', sucursal: 'Norte', nombre: 'Cliente Norte', location: { latitude: 10.7, longitude: -71.6 } },
    { id: 'J-PRUEBA', sucursal: 'Sur', nombre: 'Cliente Sur', location: { latitude: 10.61, longitude: -71.7 } },
    { id: 'CERCANO', nombre: 'Cliente cercano', location: { latitude: 10.62, longitude: -71.69 } },
    { id: 'LEJANO', nombre: 'Cliente lejano', location: { latitude: 10.75, longitude: -71.61 } },
  ];
  const options = await buildRouteOptions(clients, { anchorClientId: 'J-PRUEBA', anchorSucursal: 'Sur', anchorStopKey: 'J-PRUEBA|Sur' });
  assert.ok(options.length);
  for (const option of options) {
    assert.equal(option.route[0].id, 'J-PRUEBA');
    assert.equal(option.route[0].sucursal, 'Sur');
    assert.equal(new Set(option.route.map(stop => `${stop.id}|${stop.sucursal || ''}`)).size, 4);
  }
});
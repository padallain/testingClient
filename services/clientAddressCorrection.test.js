const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCorrectionProposal, canReviewCorrection } = require('./clientAddressCorrection.service');

test('Propuesta valida, coordenadas cero y precision opcional', () => {
  const proposal = normalizeCorrectionProposal({ details: '  Entrada correcta en calle 10  ', proposedLocation: { latitude: 0, longitude: '-71.65' } });
  assert.equal(proposal.details, 'Entrada correcta en calle 10');
  assert.equal(proposal.proposedLocation.latitude, 0);
  assert.equal(proposal.proposedLocation.longitude, -71.65);
  assert.equal(proposal.accuracyMeters, null);
});
test('No se aceptan puntos vacios, invalidos ni reportes antiguos para aprobar', () => {
  const valid = { details: 'Punto correcto', proposedLocation: { latitude: 10.6, longitude: -71.6 } };
  for (const latitude of ['', null, true, 91, 'sin punto']) assert.throws(() => normalizeCorrectionProposal({ ...valid, proposedLocation: { latitude, longitude: -71.6 } }), /Latitud/);
  assert.throws(() => normalizeCorrectionProposal({ ...valid, details: '' }), /Describe/);
  assert.throws(() => normalizeCorrectionProposal({ ...valid, proposedLocation: { latitude: 10, longitude: 181 } }), /Longitud/);
  assert.equal(canReviewCorrection({ clientId: 'CLIENTE', details: 'Reporte antiguo' }), false);
  assert.equal(canReviewCorrection({ targetClientId: 'client', proposedLocation: valid.proposedLocation }), true);
});

test('REST: chofer solicita; admin aprueba/rechaza; historial y conflictos', async context => {
  const express = require('express');
  const mongoose = require('mongoose');
  const Client = require('../models/client.model');
  const Report = require('../models/clientLocationReport.model');
  const User = require('../models/user.model');
  const { authMiddleware, requireAdminRole } = require('../controllers/auth.controllers');
  const controller = require('../controllers/clientAddressCorrection.controllers');
  const id = '507f1f77bcf86cd799439101';
  let clients = [{ _id: id, id: 'CADENA', nombre: 'Cliente', sucursal: 'Norte', location: { latitude: 10.6, longitude: -71.6 } },
    { _id: '507f1f77bcf86cd799439102', id: 'CADENA', nombre: 'Cliente', sucursal: 'Sur', location: { latitude: 10.5, longitude: -71.5 } }];
  let reports = [];
  let failReportWrite = false;
  const matches = (item, query) => Object.entries(query).every(([key, expected]) => {
    const value = key.split('.').reduce((result, part) => result?.[part], item);
    if (expected && typeof expected === 'object' && '$ne' in expected) return value != null;
    if (expected && typeof expected === 'object' && '$in' in expected) return expected.$in.map(String).includes(String(value));
    return String(value) === String(expected);
  });
  const methods = [[Client, 'find'], [Client, 'findOneAndUpdate'], [Report, 'find'], [Report, 'findOne'], [Report, 'findById'],
    [Report, 'create'], [Report, 'findOneAndUpdate'], [User, 'findById'], [mongoose, 'startSession']];
  const originals = methods.map(([owner, key]) => owner[key]);
  context.after(() => methods.forEach(([owner, key], index) => { owner[key] = originals[index]; }));
  Client.find = query => ({ lean: async () => structuredClone(clients.filter(item => matches(item, query))) });
  Client.findOneAndUpdate = (query, update) => ({ lean: async () => {
    const client = clients.find(item => matches(item, query)); if (!client) return null;
    Object.assign(client, update.$set); return structuredClone(client);
  } });
  Report.findOne = query => ({ lean: async () => structuredClone(reports.find(item => matches(item, query)) || null) });
  Report.findById = value => ({ session: () => ({ lean: async () => structuredClone(reports.find(item => item._id === value) || null) }) });
  Report.create = async data => { const report = { ...structuredClone(data), _id: `507f1f77bcf86cd7994391${String(reports.length + 10).padStart(2, '0')}` };
    reports.push(report); return { ...report, toObject: () => structuredClone(report) }; };
  Report.findOneAndUpdate = (query, update) => ({ lean: async () => {
    if (failReportWrite) throw new Error('Fallo simulado al guardar revision');
    const report = reports.find(item => matches(item, query)); if (!report) return null;
    Object.assign(report, update.$set); return structuredClone(report);
  } });
  Report.find = query => ({ sort: () => ({ limit: () => ({ lean: async () => structuredClone(reports.filter(item => matches(item, query))) }) }) });
  User.findById = async role => ({ _id: role, username: `Usuario ${role}`, email: 'test@example.invalid', role, isApproved: true, approvalRequired: false });
  mongoose.startSession = async () => ({ withTransaction: async action => {
    const beforeClients = structuredClone(clients); const beforeReports = structuredClone(reports);
    try { await action(); } catch (error) { clients = beforeClients; reports = beforeReports; throw error; }
  }, endSession: async () => {} });
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { if (req.headers['x-test-role']) req.session = { user: { id: req.headers['x-test-role'] } }; next(); });
  app.use(authMiddleware);
  app.get('/requests', controller.requireDriverOrAdmin, controller.listRequests);
  app.post('/requests', controller.requireDriverOrAdmin, controller.createRequest);
  app.post('/requests/:reportId/approve', requireAdminRole, controller.approveRequest);
  app.post('/requests/:reportId/reject', requireAdminRole, controller.rejectRequest);
  const server = await new Promise(resolve => { const running = app.listen(0, '127.0.0.1', () => resolve(running)); });
  context.after(() => { server.closeAllConnections(); server.close(); });
  const request = (path, body = null, role = 'chofer') => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(role ? { 'x-test-role': role } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  const body = { clientId: 'CADENA', sucursal: 'Norte', details: 'Entrada correcta', reporterName: 'Nombre no confiable',
    proposedLocation: { latitude: 10.61, longitude: -71.61 } };
  assert.equal((await request('/requests', body, '')).status, 401);
  assert.equal((await request('/requests', body, 'user')).status, 403);
  const withoutBranch = { ...body }; delete withoutBranch.sucursal;
  assert.equal((await request('/requests', withoutBranch)).status, 400);
  assert.equal((await request('/requests', { ...body, sucursal: 'No existe' })).status, 404);
  const created = await (await request('/requests', body)).json();
  assert.equal(created.report.status, 'pending');
  assert.equal(created.report.reporterName, 'Usuario chofer');
  assert.deepEqual(clients[0].location, { latitude: 10.6, longitude: -71.6 });
  assert.equal((await request('/requests', body)).status, 409);
  assert.equal((await request(`/requests/${created.reportId}/approve`, {}, 'chofer')).status, 403);
  reports.push({ _id: '507f1f77bcf86cd799439199', reporterId: 'otro', clientId: 'OTRO', details: 'Otro reporte' });
  const own = await (await request('/requests?status=all')).json();
  assert.equal(own.reports.length, 1);
  assert.equal(own.reports[0].locationChanged, false);
  const approved = await (await request(`/requests/${created.reportId}/approve`, { reviewNote: 'Punto verificado' }, 'admin')).json();
  assert.equal(approved.report.status, 'approved');
  assert.deepEqual(clients[0].location, body.proposedLocation);
  assert.deepEqual(clients[1].location, { latitude: 10.5, longitude: -71.5 });
  assert.equal((await request(`/requests/${created.reportId}/approve`, {}, 'admin')).status, 409);
  const next = await (await request('/requests', { ...body, proposedLocation: { latitude: 10.62, longitude: -71.62 } })).json();
  const rejected = await (await request(`/requests/${next.reportId}/reject`, { reviewNote: 'No corresponde al local' }, 'admin')).json();
  assert.equal(rejected.report.status, 'rejected');
  assert.deepEqual(clients[0].location, body.proposedLocation);
  const stale = await (await request('/requests', { ...body, proposedLocation: { latitude: 10.63, longitude: -71.63 } })).json();
  clients[0].location.latitude = 10.7;
  const staleList = await (await request('/requests?status=pending', null, 'admin')).json();
  assert.equal(staleList.reports.find(item => item._id === stale.reportId).locationChanged, true);
  assert.equal((await request(`/requests/${stale.reportId}/approve`, {}, 'admin')).status, 409);
  assert.equal(reports.find(item => item._id === stale.reportId).status, 'pending');
  const transactional = await (await request('/requests', { ...body, proposedLocation: { latitude: 10.64, longitude: -71.64 } })).json();
  const before = structuredClone(clients[0].location); failReportWrite = true;
  assert.equal((await request(`/requests/${transactional.reportId}/approve`, {}, 'admin')).status, 500);
  assert.deepEqual(clients[0].location, before);
  assert.equal(reports.find(item => item._id === transactional.reportId).status, 'pending');
});
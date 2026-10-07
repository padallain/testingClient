const mongoose = require('mongoose');
const Configuration = require('../models/transportConfiguration.model');
const TransportTrip = require('../models/transportTrip.model');
const RouteAssignment = require('../models/routeAssignment.model');
const DispatchIssueReport = require('../models/dispatchIssueReport.model');
const { defaultConfiguration, calculateTrip, compareTrip, aggregateTrips } = require('../services/transportKpi.service');
const { normalizeConfiguration, normalizeTrip, normalizeTariff, invalid } = require('../services/transportData.service');
const { buildWeeklyWorkbook, buildTripWorkbook } = require('../services/transportExcel.service');

async function configuration() {
  return Configuration.findOneAndUpdate({ key: 'default' }, { $setOnInsert: defaultConfiguration() },
    { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
}
const handler = (action) => async (req, res) => {
  try { await action(req, res); }
  catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'El viaje fue modificado por otra solicitud. Recarga y vuelve a intentar.' });
    console.error('[transport]', error.message);
    res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'No se pudo procesar el reporte de transporte.' });
  }
};
const routeId = (value) => {
  if (!mongoose.isValidObjectId(value)) invalid('Folio de ruta invalido.');
  return value;
};
function filters(query) {
  const result = {};
  for (const key of ['vehicleId', 'driverId', 'zone', 'routeCode', 'carrierId', 'freightType']) {
    if (query[key]) {
      if (typeof query[key] !== 'string') invalid(`Filtro ${key} invalido.`);
      result[key] = query[key].trim();
    }
  }
  if (!['closed', 'draft', 'all', undefined].includes(query.status)) invalid('Filtro de estado invalido.');
  if (query.status !== 'all') result.status = query.status || 'closed';
  for (const key of ['from', 'to']) {
    if (query[key] && (typeof query[key] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(query[key])
      || !Number.isFinite(Date.parse(query[key])) || new Date(query[key]).toISOString().slice(0, 10) !== query[key])) invalid('Fecha de filtro invalida.');
  }
  if (query.from && query.to && query.from > query.to) invalid('Rango de fechas invertido.');
  if (query.from || query.to) result.date = { ...(query.from ? { $gte: query.from } : {}), ...(query.to ? { $lte: query.to } : {}) };
  return result;
}
function draftWithCurrentGuide(trip, route) {
  if (trip.status !== 'draft' || !route?.loadGuide?.orders?.length) return trip;
  return { ...trip, guideSnapshot: route.loadGuide,
    loadedAmount: route.loadGuide.orders.reduce((sum, order) => sum + Math.round(Number(order.total) * 100), 0) / 100 };
}
async function records(query, config) {
  const count = await TransportTrip.countDocuments(filters(query));
  if (count > 10000) invalid('El reporte supera 10.000 viajes. Reduce el rango de fechas.');
  let trips = await TransportTrip.find(filters(query)).sort({ date: -1, _id: -1 }).lean();
  const drafts = trips.filter(trip => trip.status === 'draft');
  if (drafts.length) {
    const routes = await RouteAssignment.find({ _id: { $in: drafts.map(trip => trip.routeId) } }).select('loadGuide').lean();
    const byId = new Map(routes.map(route => [String(route._id), route]));
    trips = trips.map(trip => draftWithCurrentGuide(trip, byId.get(String(trip.routeId))));
  }
  return trips.map((trip) => { const applied = trip.configurationSnapshot || config;
    return { trip, metrics: trip.metricsSnapshot || calculateTrip(trip, applied), comparison: compareTrip(trip, applied) }; });
}
function grouping(query) {
  const period = query.period || 'week';
  const groupBy = query.groupBy || 'vehicleId';
  if (!['day', 'week', 'month'].includes(period) || !['vehicleId', 'driverId', 'zone', 'routeCode', 'carrierId', 'freightType'].includes(groupBy)) invalid('Agrupacion invalida.');
  return { period, groupBy };
}

exports.getConfiguration = handler(async (_req, res) => res.json({ configuration: await configuration() }));
exports.updateConfiguration = handler(async (req, res) => {
  const value = normalizeConfiguration(req.body);
  const current = await configuration();
  if (Number(req.body.version) !== current.version) invalid('La configuracion cambio. Recarga antes de guardar.', 409);
  const updated = await Configuration.findOneAndUpdate({ key: 'default', version: current.version },
    { $set: value, $inc: { version: 1 } }, { new: true, runValidators: true }).lean();
  if (!updated) invalid('La configuracion fue modificada por otra persona.', 409);
  res.json({ configuration: updated });
});
async function persistTrip(id, data, existing, input) {
  let trip;
  if (existing) {
    if (!input.updatedAt || new Date(input.updatedAt).getTime() !== new Date(existing.updatedAt).getTime()) invalid('El viaje cambio. Recarga antes de guardar.', 409);
    trip = await TransportTrip.findOneAndUpdate({ routeId: id, status: 'draft', updatedAt: existing.updatedAt },
      { $set: data }, { new: true, runValidators: true }).lean();
    if (!trip) invalid('El viaje fue cerrado o modificado por otra solicitud.', 409);
  } else trip = (await TransportTrip.create(data)).toObject();
  return trip;
}
exports.saveTrip = handler(async (req, res) => {
  const id = routeId(req.params.routeId);
  const route = await RouteAssignment.findById(id).lean();
  if (!route) invalid('Ruta no encontrada.', 404);
  const config = await configuration();
  const existing = await TransportTrip.findOne({ routeId: id }).lean();
  const data = normalizeTrip(req.body, route, config, existing);
  const trip = await persistTrip(id, data, existing, req.body);
  res.json({ trip, metrics: trip.metricsSnapshot || calculateTrip(trip, config), comparison: compareTrip(trip, trip.configurationSnapshot || config) });
});
exports.getGuideKpis = handler(async (req, res) => {
  const id = routeId(req.params.routeId);
  let trip = await TransportTrip.findOne({ routeId: id }).lean();
  const route = await RouteAssignment.findById(id).lean();
  if (!trip) {
    if (!route) invalid('Ruta no encontrada.', 404);
    const issues = await DispatchIssueReport.find({ routeId: id }).lean();
    return res.json({ trip: null, route, issues, metrics: null, message: 'La guia aun no tiene datos del viaje.' });
  }
  trip = draftWithCurrentGuide(trip, route);
  const config = trip.configurationSnapshot || await configuration();
  const issues = trip.issueReportsSnapshot || await DispatchIssueReport.find({ routeId: id }).lean();
  res.json({ trip, route, issues, metrics: trip.metricsSnapshot || calculateTrip(trip, config), comparison: compareTrip(trip, config) });
});

exports.listRoutesToFinish = handler(async (req, res) => {
  const status = req.query.status || 'active';
  if (!['active', 'completed', 'all'].includes(status)) invalid('Estado de ruta invalido.');
  const query = status === 'all' ? {} : { status };
  const routes = await RouteAssignment.find(query).sort({ createdAt: -1 }).limit(500)
    .select('driverId driverName routeLabel status totalWeight createdAt loadGuide stops').lean();
  const trips = await TransportTrip.find({ routeId: { $in: routes.map(route => route._id) } })
    .select('routeId status deliveryOutcome loadedAmount returnedAmount closedAt').lean();
  res.json({ routes: routes.map(route => ({ ...route, trip: trips.find(trip => String(trip.routeId) === String(route._id)) || null })), limit: 500 });
});

exports.finishRoute = handler(async (req, res) => {
  const id = routeId(req.params.routeId);
  const route = await RouteAssignment.findById(id).lean();
  if (!route) invalid('Ruta no encontrada.', 404);
  const existing = await TransportTrip.findOne({ routeId: id }).lean();
  let trip = existing;
  if (existing?.status === 'closed') {
    if (Object.keys(req.body || {}).length) invalid('El viaje ya esta cerrado. Recarga para terminar la ruta sin modificar su liquidacion.', 409);
  } else {
    if (!req.body.deliveryOutcome) invalid('Confirma el resultado de la entrega.');
    const config = await configuration();
    const data = normalizeTrip({ ...req.body, status: 'closed' }, route, config, existing);
    if (!data.departureAt || !data.returnAt || data.plannedStops == null || data.attendedStops == null) invalid('Confirma salida, regreso y paradas para terminar la ruta.');
    for (const [loaded, delivered] of [['loadedKg', 'deliveredKg'], ['loadedPackages', 'deliveredPackages']]) {
      if (data[loaded] != null && data[delivered] == null) invalid('Confirma las cantidades entregadas.');
    }
    data.issueReportsSnapshot = await DispatchIssueReport.find({ routeId: id }).lean();
    data.settledBy = { id: String(req.user?.id || ''), name: String(req.user?.username || '') };
    trip = await persistTrip(id, data, existing, req.body);
  }
  let completed;
  try {
    completed = await RouteAssignment.findOneAndUpdate({ _id: id }, { $set: { status: 'completed' } }, { new: true }).lean();
    if (!completed) throw new Error('Ruta no encontrada al completar.');
  } catch (_error) {
    invalid('La liquidacion quedo guardada, pero no se pudo terminar la ruta. Recarga y pulsa Terminar ruta nuevamente.', 503);
  }
  const config = trip.configurationSnapshot;
  res.json({ route: completed, trip, metrics: trip.metricsSnapshot, comparison: config ? compareTrip(trip, config) : null });
});

exports.exportTrip = handler(async (req, res) => {
  const id = routeId(req.params.routeId);
  let trip = await TransportTrip.findOne({ routeId: id }).lean();
  if (!trip) invalid('Guarda los datos del viaje antes de descargar su liquidacion.', 404);
  const currentRoute = await RouteAssignment.findById(id).lean();
  trip = draftWithCurrentGuide(trip, currentRoute);
  const config = trip.configurationSnapshot || await configuration();
  const issues = trip.issueReportsSnapshot || await DispatchIssueReport.find({ routeId: id }).lean();
  const record = { trip, route: trip.routeSnapshot || currentRoute, currentRouteStatus: currentRoute?.status || 'Ruta eliminada',
    routeSource: trip.routeSnapshot ? 'Snapshot al liquidar' : 'Ruta actual; viaje sin snapshot',
    issues, issuesSource: trip.issueReportsSnapshot ? 'Snapshot al liquidar' : 'Incidencias actuales; viaje sin snapshot',
    metrics: trip.metricsSnapshot || calculateTrip(trip, config), comparison: compareTrip(trip, config), configuration: config };
  if (req.query.format === 'json') {
    res.set('Content-Disposition', `attachment; filename="Viaje_${id}.json"`);
    return res.json(record);
  }
  if (req.query.format && req.query.format !== 'xlsx') invalid('Formato invalido.');
  const workbook = await buildTripWorkbook(record);
  const buffer = await workbook.xlsx.writeBuffer();
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', `attachment; filename="Liquidacion_${id}.xlsx"`);
  res.send(buffer);
});
exports.listKpis = handler(async (req, res) => {
  const config = await configuration();
  res.json({ records: await records(req.query, config) });
});
exports.getAggregates = handler(async (req, res) => {
  const config = await configuration();
  res.json({ groups: aggregateTrips(await records(req.query, config), grouping(req.query)) });
});
exports.getComparisons = handler(async (req, res) => {
  const config = await configuration();
  res.json({ records: (await records({ ...req.query, freightType: 'externo' }, config)) });
});
exports.planTrip = handler(async (req, res) => {
  const config = await configuration();
  const body = req.body;
  const vehicle = config.vehicles.find((item) => item.id === body.vehicleId);
  const carrier = config.carriers.find((item) => item.id === body.carrierId);
  if (!['interno', 'externo'].includes(body.freightType)) invalid('Selecciona tipo de flete.');
  if (body.freightType === 'interno' && !vehicle) invalid('Vehiculo no configurado.');
  if (body.freightType === 'externo' && !carrier) invalid('Transportista no configurado.');
  for (const key of ['km', 'loadedAmount', 'allowances']) if (body[key] == null || body[key] === '' || !Number.isFinite(Number(body[key])) || Number(body[key]) < 0) invalid(`${key}: dato no negativo requerido.`);
  const trip = { ...body, date: '2000-01-01', vehicleTypeId: vehicle?.vehicleTypeId,
    returnedAmount: 0, tariff: body.freightType === 'externo' ? normalizeTariff(body.tariff || carrier) : null,
    km: Number(body.km), loadedAmount: Number(body.loadedAmount), allowances: Number(body.allowances) };
  res.json({ metrics: calculateTrip(trip, config), comparison: compareTrip(trip, config),
    assumptions: ['Planificacion: km estimados y devoluciones previstas cero; no es un viaje ejecutado.'] });
});
exports.exportWeekly = handler(async (req, res) => {
  if (!req.query.from || !req.query.to) invalid('Indica desde/hasta para exportar.');
  const config = await configuration();
  const selected = await records(req.query, config);
  if ((Date.parse(req.query.to) - Date.parse(req.query.from)) / 86400000 > 6) invalid('El reporte semanal admite hasta siete dias.');
  const workbook = await buildWeeklyWorkbook(selected, aggregateTrips(selected, grouping(req.query)), config);
  const buffer = await workbook.xlsx.writeBuffer();
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', `attachment; filename="Transporte_${req.query.from}_${req.query.to}.xlsx"`);
  res.send(buffer);
});
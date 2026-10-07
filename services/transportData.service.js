const { defaultConfiguration, calculateTrip, known, money } = require('./transportKpi.service');
const { normalizeSettlement } = require('./transportSettlement.service');

function invalid(message, code = 400) {
  const error = new Error(message);
  error.statusCode = code;
  throw error;
}
const text = (value) => String(value ?? '').trim();
function numeric(value, label, { nullable = false, positive = false } = {}) {
  if (nullable && (value === '' || value == null)) return null;
  if (!known(value) || Number(value) < 0 || (positive && Number(value) === 0)) invalid(`${label}: numero ${positive ? 'positivo' : 'no negativo'} requerido.`);
  return Number(value);
}
function normalizeConfiguration(input) {
  const defaults = defaultConfiguration();
  const settings = {};
  for (const field of Object.keys(defaults.settings)) settings[field] = numeric(input.settings?.[field], field);
  for (const field of ['targetRatio', 'yellowFrom', 'returnLimit', 'unattendedLimit', 'fillTarget', 'fuelDeviation', 'grossMargin']) {
    if (settings[field] > 1) invalid(`${field}: debe ser una fraccion entre 0 y 1.`);
  }
  if (settings.targetRatio <= 0 || settings.yellowFrom >= settings.targetRatio || settings.maxHours <= 0
    || settings.departureHour > 23) invalid('Umbrales invalidos.');
  const lists = {};
  for (const name of ['vehicleTypes', 'carriers', 'vehicles']) {
    if (!Array.isArray(input[name]) || input[name].length > 500) invalid(`${name}: lista invalida.`);
    const ids = new Set();
    lists[name] = input[name].map((item) => {
      const id = text(item.id);
      if (!id || ids.has(id)) invalid(`${name}: identificador vacio o repetido.`);
      ids.add(id);
      const result = { id, name: text(item.name), source: text(item.source) || 'Dato del usuario' };
      if (!result.name) invalid(`${name}: nombre requerido.`);
      if (name === 'vehicleTypes') {
        for (const field of Object.keys(defaults.vehicleTypes[0]).filter((key) => !['id', 'name', 'source'].includes(key))) {
          result[field] = numeric(item[field], field, { nullable: true,
            positive: ['workDays', 'fuelLiters', 'fuelKm', 'baseKmMonthly'].includes(field) });
        }
      } else if (name === 'carriers') {
        if (!['fijo', 'porcentaje'].includes(item.mode) || !['cargado', 'entregado'].includes(item.base)) invalid('Modalidad/base de tarifa invalida.');
        Object.assign(result, { mode: item.mode, base: item.base, fixed: numeric(item.fixed, 'Monto fijo'),
          percentage: numeric(item.percentage, 'Porcentaje'), minimum: numeric(item.minimum, 'Minimo') });
        if (result.percentage > 1) invalid('Porcentaje de tarifa debe ser una fraccion entre 0 y 1.');
      } else {
        Object.assign(result, { plate: text(item.plate), vehicleTypeId: text(item.vehicleTypeId),
          capacityKg: numeric(item.capacityKg, 'Capacidad kg', { nullable: true, positive: true }),
          capacityPackages: numeric(item.capacityPackages, 'Capacidad bultos', { nullable: true, positive: true }) });
      }
      return result;
    });
  }
  for (const vehicle of lists.vehicles) {
    if (!lists.vehicleTypes.some((type) => type.id === vehicle.vehicleTypeId)) invalid(`Tipo de vehiculo desconocido: ${vehicle.vehicleTypeId}.`);
  }
  return { settings, ...lists };
}

function normalizeTrip(input, route, configuration, existing = null) {
  if (!route.loadGuide?.orders?.length) invalid('La ruta no tiene guia de carga.');
  if (existing?.status === 'closed') invalid('El viaje esta cerrado; sus datos y parametros historicos no se modifican.', 409);
  const value = { ...(existing || {}), ...input };
  const vehicle = configuration.vehicles.find((item) => item.id === value.vehicleId);
  if (!vehicle) invalid('Selecciona un vehiculo registrado en configuracion.');
  const date = text(value.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))
    || new Date(date).toISOString().slice(0, 10) !== date) invalid('Fecha operativa del viaje invalida.');
  if (!['interno', 'externo'].includes(value.freightType)) invalid('Tipo de flete invalido.');
  if (!['draft', 'closed'].includes(value.status || 'draft')) invalid('Estado del viaje invalido.');
  const snapshot = JSON.parse(JSON.stringify(route.loadGuide));
  const loadedAmount = snapshot.orders.reduce((sum, order) => sum + Math.round(Number(order.total) * 100), 0) / 100;
  if (!Number.isFinite(loadedAmount) || loadedAmount < 0) invalid('La guia contiene montos invalidos.');
  const result = { routeId: route._id, guideNumber: route.loadGuide.number || route.routeLabel,
    guideSnapshot: snapshot, date, status: value.status || 'draft', vehicleId: vehicle.id,
    vehicleName: vehicle.plate || vehicle.name, vehicleTypeId: vehicle.vehicleTypeId,
    driverId: route.driverId, driverName: route.driverName, helperName: text(value.helperName),
    zone: text(value.zone), routeCode: text(value.routeCode), freightType: value.freightType,
    carrierId: '', carrierName: '', tariff: null, loadedAmount,
    comparisonVehicleTypeId: text(value.comparisonVehicleTypeId), notes: text(value.notes),
    configurationSnapshot: null, metricsSnapshot: null, closedAt: null };
  if (!result.zone || !result.routeCode) invalid('Zona y ruta comercial son obligatorias.');
  if (result.comparisonVehicleTypeId && !configuration.vehicleTypes.some((type) => type.id === result.comparisonVehicleTypeId)) invalid('Tipo para comparar desconocido.');
  if (value.freightType === 'externo') {
    const carrier = configuration.carriers.find((item) => item.id === value.carrierId);
    if (!carrier) invalid('Selecciona un transportista configurado.');
    result.carrierId = carrier.id;
    result.carrierName = carrier.name;
    result.tariff = normalizeTariff(value.tariff || carrier);
  }
  for (const field of ['returnedAmount', 'loadedKg', 'deliveredKg', 'loadedPackages', 'deliveredPackages',
    'plannedStops', 'attendedStops', 'km', 'estimatedKm', 'estimatedAllowances', 'fuelLiters', 'allowances']) {
    result[field] = numeric(value[field], field, { nullable: true });
  }
  result.capacityKg = numeric(value.capacityKg ?? vehicle.capacityKg, 'Capacidad kg', { nullable: true, positive: true });
  result.capacityPackages = numeric(value.capacityPackages ?? vehicle.capacityPackages, 'Capacidad bultos', { nullable: true, positive: true });
  if (result.loadedKg === null && route.totalWeight > 0) result.loadedKg = route.totalWeight;
  if (result.plannedStops === null) result.plannedStops = (route.originalStops?.length ? route.originalStops : route.stops || []).length;
  if (result.attendedStops === null && result.status === 'closed') result.attendedStops = (route.stops || []).filter((stop) => stop.dispatched).length;
  for (const field of ['returnedAmount', 'allowances', 'estimatedAllowances']) if (result[field] !== null) result[field] = money(result[field]);
  if (result.returnedAmount !== null && result.returnedAmount > loadedAmount) invalid('El monto devuelto supera al cargado.');
  for (const [delivered, loaded] of [['deliveredKg', 'loadedKg'], ['deliveredPackages', 'loadedPackages'], ['attendedStops', 'plannedStops']]) {
    if (result[delivered] !== null && result[loaded] !== null && result[delivered] > result[loaded]) invalid(`${delivered} supera a ${loaded}.`);
  }
  if (['plannedStops', 'attendedStops', 'loadedPackages', 'deliveredPackages'].some((field) => result[field] !== null && !Number.isInteger(result[field]))) invalid('Paradas y bultos deben ser enteros.');
  for (const field of ['departureAt', 'returnAt']) {
    if (value[field] instanceof Date) value[field] = value[field].toISOString();
    if (value[field] && (typeof value[field] !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(value[field]) || !Number.isFinite(Date.parse(value[field])))) invalid(`${field}: fecha/hora con zona horaria requerida.`);
    result[field] = value[field] ? new Date(value[field]).toISOString() : null;
  }
  if (result.departureAt && result.returnAt && Date.parse(result.returnAt) < Date.parse(result.departureAt)) invalid('El regreso no puede ser anterior a la salida.');
  result.deliveryOutcome = '';
  result.returns = [];
  if (value.deliveryOutcome) Object.assign(result, normalizeSettlement({ ...value, ...result, deliveryOutcome: value.deliveryOutcome, returns: value.returns }, snapshot));
  result.routeSnapshot = null;
  if (result.status === 'closed') {
    const metrics = calculateTrip(result, configuration);
    if (metrics.cost === null || metrics.netSales === null || result.km === null) invalid('Para cerrar: completa costos/tarifa, km, viaticos y devoluciones.');
    result.configurationSnapshot = JSON.parse(JSON.stringify(configuration));
    result.metricsSnapshot = metrics;
    result.routeSnapshot = JSON.parse(JSON.stringify(route));
    result.closedAt = new Date();
  }
  return result;
}

function normalizeTariff(tariff) {
  if (!['fijo', 'porcentaje'].includes(tariff.mode) || !['cargado', 'entregado'].includes(tariff.base)) invalid('Modalidad/base invalida.');
  const result = { mode: tariff.mode, base: tariff.base, fixed: money(numeric(tariff.fixed, 'Tarifa fija')),
    percentage: numeric(tariff.percentage, 'Porcentaje'), minimum: money(numeric(tariff.minimum, 'Minimo')) };
  if (result.percentage > 1) invalid('Porcentaje invalido.');
  return result;
}

module.exports = { normalizeConfiguration, normalizeTrip, normalizeTariff, invalid };
const Decimal = require('decimal.js');

const D = (value) => new Decimal(value);
const money = (value) => D(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
const known = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const divide = (numerator, denominator) => known(numerator) && known(denominator) && Number(denominator) > 0
  ? D(numerator).div(denominator).toNumber() : null;

function defaultConfiguration() {
  const empty = (id, name) => ({ id, name, source: 'Pendiente: dato del usuario', depreciationMonthly: null, permitMonthly: null,
    driverDaily: null, helperDaily: null, workDays: null, fuelLiters: null, fuelKm: null, fuelPrice: null,
    oilMonthly: null, tiresMonthly: null, maintenanceMonthly: null, baseKmMonthly: null, coolingDaily: null });
  return {
    settings: { targetRatio: 0.02, yellowFrom: 0.015, returnLimit: 0.03, unattendedLimit: 0.02,
      fillTarget: 0.85, maxHours: 9, departureHour: 8, fuelDeviation: 0.15, grossMargin: 0.04 },
    vehicleTypes: [
      { id: 'l300', name: 'L300', source: 'Dato del usuario aprobado: combustible $0.50/l', depreciationMonthly: 119.05,
        permitMonthly: 4.17, driverDaily: 20, helperDaily: 13, workDays: 24, fuelLiters: 1, fuelKm: 10,
        fuelPrice: 0.5, oilMonthly: 30, tiresMonthly: 13.89, maintenanceMonthly: 200, baseKmMonthly: 1680, coolingDaily: 0 },
      { id: 'camion', name: 'Iveco Daily / JAC 1061', source: 'Dato del usuario aprobado: consumo exacto 40 litros / 150 km',
        depreciationMonthly: 208.33, permitMonthly: 8.33, driverDaily: 20, helperDaily: 13, workDays: 24,
        fuelLiters: 40, fuelKm: 150, fuelPrice: 0.7, oilMonthly: 200, tiresMonthly: 33.06,
        maintenanceMonthly: 300, baseKmMonthly: 4800, coolingDaily: 0 },
      empty('canter', 'Mitsubishi Canter'), empty('dongfeng', 'Dongfeng refrigerado'),
    ],
    carriers: [
      { id: 'maracaibo', name: 'Transportista Maracaibo', mode: 'fijo', fixed: 170, percentage: 0,
        minimum: 0, base: 'entregado', source: 'Dato del usuario: $170 por viaje/dia' },
      { id: 'cabimas', name: 'Transportista Cabimas', mode: 'porcentaje', fixed: 0, percentage: 0.025,
        minimum: 0, base: 'entregado', source: 'Dato del usuario: 2.5%; base entregado y minimo 0 editables' },
    ],
    vehicles: [],
  };
}

function vehicleCosts(type) {
  const required = ['depreciationMonthly', 'permitMonthly', 'driverDaily', 'helperDaily', 'workDays',
    'fuelLiters', 'fuelKm', 'fuelPrice', 'oilMonthly', 'tiresMonthly', 'maintenanceMonthly', 'baseKmMonthly', 'coolingDaily'];
  if (!type || required.some((field) => !known(type[field]) || Number(type[field]) < 0)
    || type.workDays <= 0 || type.fuelLiters <= 0 || type.fuelKm <= 0 || type.baseKmMonthly <= 0) return null;
  const fixedMonthly = D(type.depreciationMonthly).plus(type.permitMonthly)
    .plus(D(type.driverDaily).plus(type.helperDaily).times(type.workDays));
  const fuelPerKm = D(type.fuelLiters).div(type.fuelKm);
  const variableMonthly = fuelPerKm.times(type.baseKmMonthly).times(type.fuelPrice)
    .plus(type.oilMonthly).plus(type.tiresMonthly).plus(type.maintenanceMonthly);
  return { fixedMonthly: fixedMonthly.toNumber(), fixedDaily: fixedMonthly.div(type.workDays).toNumber(),
    variableMonthly: variableMonthly.toNumber(), variablePerKm: variableMonthly.div(type.baseKmMonthly).toNumber(),
    theoreticalKmPerLiter: D(type.fuelKm).div(type.fuelLiters).toNumber(), coolingDaily: Number(type.coolingDaily) };
}

function ownCost(type, km, allowances) {
  const costs = vehicleCosts(type);
  return costs && known(km) && known(allowances)
    ? money(D(costs.fixedDaily).plus(D(costs.variablePerKm).times(km)).plus(costs.coolingDaily).plus(allowances)) : null;
}

function calculateTrip(trip, configuration) {
  const settings = configuration.settings;
  const type = configuration.vehicleTypes.find((item) => item.id === trip.vehicleTypeId);
  const tariff = trip.tariff || configuration.carriers.find((item) => item.id === trip.carrierId);
  const costs = vehicleCosts(type);
  const sales = known(trip.loadedAmount) && known(trip.returnedAmount)
    ? money(D(trip.loadedAmount).minus(trip.returnedAmount)) : null;
  let cost = null;
  if (trip.freightType === 'interno') cost = ownCost(type, trip.km, trip.allowances);
  if (trip.freightType === 'externo' && tariff && known(trip.allowances)) {
    const base = tariff.base === 'cargado' ? trip.loadedAmount : sales;
    if (tariff.mode === 'fijo' && known(tariff.fixed)) cost = money(D(tariff.fixed).plus(trip.allowances));
    if (tariff.mode === 'porcentaje' && known(base) && known(tariff.percentage) && known(tariff.minimum)) {
      cost = money(Decimal.max(D(base).times(tariff.percentage), tariff.minimum).plus(trip.allowances));
    }
  }
  const ratio = divide(cost, sales);
  const noSales = sales !== null && sales <= 0;
  const minimumSales = known(cost) ? money(D(cost).div(settings.targetRatio)) : null;
  const excess = known(cost) && sales !== null ? money(Decimal.max(0, D(cost).minus(D(sales).times(settings.targetRatio)))) : null;
  const profit = known(cost) && sales !== null ? money(D(sales).times(settings.grossMargin).minus(cost)) : null;
  const fillKg = divide(trip.loadedKg, trip.capacityKg);
  const fillPackages = divide(trip.loadedPackages, trip.capacityPackages);
  const start = trip.departureAt ? new Date(trip.departureAt) : null;
  const end = trip.returnAt ? new Date(trip.returnAt) : null;
  const hours = start && end && Number.isFinite(start.getTime()) && Number.isFinite(end.getTime())
    ? (end - start) / 3600000 : null;
  const departureParts = start && Number.isFinite(start.getTime()) ? new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Caracas', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(start) : null;
  const departureHour = departureParts ? Number(departureParts.find(part => part.type === 'hour').value)
    + Number(departureParts.find(part => part.type === 'minute').value) / 60
    + Number(departureParts.find(part => part.type === 'second').value) / 3600 : null;
  const fuelYield = trip.freightType === 'interno' ? divide(trip.km, trip.fuelLiters) : null;
  const fuelDifference = fuelYield !== null && costs ? D(1).minus(D(fuelYield).div(costs.theoreticalKmPerLiter)).toNumber() : null;
  const returnRatio = divide(trip.returnedAmount, trip.loadedAmount);
  const unattendedRatio = known(trip.plannedStops) && known(trip.attendedStops)
    ? divide(Number(trip.plannedStops) - Number(trip.attendedStops), trip.plannedStops) : null;
  const fillRatio = fillKg !== null ? fillKg : fillPackages;
  const alerts = [];
  if (cost === null) alerts.push('Costo incompleto: configura costo/tarifa, km y viaticos.');
  if (sales === null) alerts.push('Venta incompleta: confirma monto cargado y devuelto.');
  if (noSales) alerts.push('Sin venta entregada.');
  if (ratio !== null && ratio > settings.targetRatio) alerts.push('Flete por encima de la meta.');
  if (fillRatio !== null && fillRatio < settings.fillTarget) alerts.push('Llenado bajo la meta.');
  if (returnRatio !== null && returnRatio > settings.returnLimit) alerts.push('Devoluciones altas.');
  if (unattendedRatio !== null && unattendedRatio > settings.unattendedLimit) alerts.push('Clientes no atendidos por encima de la meta.');
  if (hours !== null && hours > settings.maxHours) alerts.push('Jornada extensa.');
  if (departureHour !== null && departureHour > settings.departureHour) alerts.push('Salida tardia.');
  if (fuelDifference !== null && fuelDifference > settings.fuelDeviation) alerts.push('Km/l cargado bajo la referencia: revisar carga de combustible y funcionamiento.');
  return {
    cost, netSales: sales, freightRatio: ratio,
    semaphore: noSales ? 'rojo' : ratio === null ? 'incompleto' : ratio > settings.targetRatio ? 'rojo' : ratio >= settings.yellowFrom ? 'amarillo' : 'verde',
    minimumSales, gap: minimumSales !== null && sales !== null ? money(D(sales).minus(minimumSales)) : null,
    excess, estimatedProfit: profit, profitMargin: divide(profit, sales), grossMargin: settings.grossMargin,
    fillKg, fillPackages, fillRatio, fillUnit: fillKg !== null ? 'kg' : fillPackages !== null ? 'bultos' : null,
    ticketPerStop: divide(sales, trip.attendedStops), costPerDeliveredPackage: divide(cost, trip.deliveredPackages),
    costPerDeliveredKg: divide(cost, trip.deliveredKg), returnRatio, unattendedRatio, hours,
    kmPerStop: divide(trip.km, trip.attendedStops), realCostPerKm: divide(cost, trip.km),
    fuelYield, theoreticalFuelYield: costs?.theoreticalKmPerLiter ?? null, fuelDifference,
    fuelMeasurement: trip.freightType === 'interno' ? 'km/l cargado; no equivale necesariamente al combustible consumido' : null,
    allowances: known(trip.allowances) ? Number(trip.allowances) : null, alerts,
  };
}

function compareTrip(trip, configuration) {
  if (trip.freightType !== 'externo') return null;
  const metrics = calculateTrip(trip, configuration);
  const typeId = trip.comparisonVehicleTypeId;
  const type = configuration.vehicleTypes.find((item) => item.id === typeId);
  const internalCost = ownCost(type, trip.km, trip.allowances);
  const tariff = trip.tariff || configuration.carriers.find((item) => item.id === trip.carrierId);
  const saving = internalCost !== null && metrics.cost !== null ? money(D(metrics.cost).minus(internalCost)) : null;
  const threshold = internalCost !== null && tariff?.mode === 'porcentaje' && tariff.percentage > 0
    ? money(D(internalCost).minus(trip.allowances).div(tariff.percentage)) : null;
  const minimumAlwaysHigher = internalCost !== null && tariff?.mode === 'porcentaje'
    && Number(tariff.minimum) + Number(trip.allowances) >= internalCost;
  return { vehicleTypeId: typeId || null, internalCost, externalCost: metrics.cost, saving,
    preferred: saving === null ? 'incompleto' : saving > 0 ? 'interno' : saving < 0 ? 'externo' : 'igual',
    breakEvenSales: threshold, breakEvenBase: tariff?.base || null, minimumAlwaysHigher,
    note: 'Comparacion economica; verificar capacidad/disponibilidad. Umbral sobre la base de tarifa; minimo puede hacer preferible propio en todo el rango.' };
}

function periodKey(date, period) {
  if (period === 'month') return date.slice(0, 7);
  if (period === 'day') return date;
  const monday = new Date(`${date}T12:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  return monday.toISOString().slice(0, 10);
}

function aggregateTrips(records, { period = 'week', groupBy = 'vehicleId' } = {}) {
  const groups = new Map();
  const supports = ['fillRatio', 'ticketPerStop', 'costPerDeliveredPackage', 'costPerDeliveredKg', 'returnRatio',
    'unattendedRatio', 'hours', 'kmPerStop', 'realCostPerKm', 'fuelYield', 'allowances'];
  for (const record of records) {
    const key = JSON.stringify([periodKey(record.trip.date, period), record.trip[groupBy] || 'Sin dato']);
    const group = groups.get(key) || { period: periodKey(record.trip.date, period), group: record.trip[groupBy] || 'Sin dato',
      trips: 0, cost: D(0), sales: D(0), excess: D(0), redTrips: 0, incompleteTrips: 0, values: {} };
    const metrics = record.metrics;
    group.trips += 1;
    if (metrics.cost === null || metrics.netSales === null) group.incompleteTrips += 1;
    if (metrics.cost !== null) group.cost = group.cost.plus(metrics.cost);
    if (metrics.netSales !== null) group.sales = group.sales.plus(metrics.netSales);
    if (metrics.excess !== null) group.excess = group.excess.plus(metrics.excess);
    if (metrics.semaphore === 'rojo') group.redTrips += 1;
    for (const metric of supports) {
      if (metrics[metric] !== null && metrics[metric] !== undefined) {
        (group.values[metric] ||= []).push(metrics[metric]);
      }
    }
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    period: group.period, group: group.group, trips: group.trips, costTotal: money(group.cost),
    netSalesTotal: money(group.sales), weightedRatio: group.incompleteTrips ? null : divide(group.cost, group.sales),
    excessTotal: money(group.excess), incompleteTrips: group.incompleteTrips,
    redTripRatio: group.redTrips / group.trips,
    averages: Object.fromEntries(supports.map((metric) => [metric, group.values[metric]?.length
      ? group.values[metric].reduce((sum, value) => sum + value, 0) / group.values[metric].length : null])),
  }));
}

module.exports = { defaultConfiguration, vehicleCosts, ownCost, calculateTrip, compareTrip, aggregateTrips, money, known };
const path = require('path');
const { defaultConfiguration, calculateTrip, compareTrip, aggregateTrips } = require('./services/transportKpi.service');
const { buildWeeklyWorkbook } = require('./services/transportExcel.service');

async function main() {
  const configuration = defaultConfiguration();
  const base = { date: '2026-10-05', status: 'closed', vehicleName: 'EJEMPLO - NO REAL', driverName: 'Chofer de prueba',
    zone: 'Maracaibo', routeCode: 'EJEMPLO', km: 200, vehicleTypeId: 'camion', returnedAmount: 0, allowances: 0,
    plannedStops: 10, attendedStops: 10, loadedKg: 4000, deliveredKg: 4000, capacityKg: 5000,
    loadedPackages: 200, deliveredPackages: 200, departureAt: '2026-10-05T08:00:00-04:00', returnAt: '2026-10-05T16:00:00-04:00' };
  const cases = [
    { freightType: 'interno', loadedAmount: 5079 },
    { freightType: 'interno', km: 100, loadedAmount: 3590 },
    { freightType: 'interno', vehicleTypeId: 'l300', km: 70, loadedAmount: 4000 },
    { freightType: 'externo', carrierId: 'maracaibo', carrierName: 'Maracaibo - prueba', loadedAmount: 8500 },
    { freightType: 'externo', carrierId: 'cabimas', carrierName: 'Cabimas - prueba', loadedAmount: 8000, zone: 'Cabimas', comparisonVehicleTypeId: 'camion' },
    { freightType: 'externo', carrierId: 'cabimas', carrierName: 'Cabimas minimo - prueba', loadedAmount: 2000, zone: 'Cabimas',
      tariff: { mode: 'porcentaje', percentage: .025, minimum: 60, base: 'entregado' }, comparisonVehicleTypeId: 'camion' },
  ];
  const records = cases.map((value, index) => {
    const trip = { ...base, ...value, guideNumber: `EJEMPLO-${index + 1}`, vehicleId: `PRUEBA-${index + 1}`, notes: 'Datos ficticios. No se guardan en MongoDB.' };
    return { trip, metrics: calculateTrip(trip, configuration), comparison: compareTrip(trip, configuration) };
  });
  const workbook = await buildWeeklyWorkbook(records, aggregateTrips(records), configuration);
  const filename = path.join(__dirname, 'Transporte_Ejemplo_Semanal.xlsx');
  await workbook.xlsx.writeFile(filename);
  console.table(records.map(({ trip, metrics }) => ({ guia: trip.guideNumber, costo: metrics.cost, venta: metrics.netSales,
    flete: `${(metrics.freightRatio * 100).toFixed(2)}%`, sobrecosto: metrics.excess, gananciaEstimada: metrics.estimatedProfit })));
  console.log(`Reporte ficticio generado: ${filename}`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
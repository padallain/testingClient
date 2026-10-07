const ExcelJS = require('exceljs');

async function buildWeeklyWorkbook(records, aggregates, configuration) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'PAD Distribucion';
  const sheet = workbook.addWorksheet('Viajes');
  const columns = [
    ['Fecha', 'date', 14], ['Guia', 'guideNumber', 30], ['Vehiculo', 'vehicleName', 22], ['Chofer', 'driverName', 25],
    ['Ruta', 'routeCode', 18], ['Zona', 'zone', 20], ['Tipo flete', 'freightType', 14], ['Transportista', 'carrierName', 25],
    ['Venta entregada $', 'netSales', 20], ['Costo viaje $', 'cost', 18], ['Flete / venta', 'freightRatio', 18],
    ['Semaforo', 'semaphore', 16], ['Venta minima $', 'minimumSales', 20], ['Brecha $', 'gap', 18],
    ['Sobrecosto $', 'excess', 18], ['Ganancia estimada $', 'estimatedProfit', 22], ['Margen restante', 'profitMargin', 18],
    ['Llenado kg', 'fillKg', 15], ['Llenado bultos', 'fillPackages', 18], ['Ticket/parada $', 'ticketPerStop', 20],
    ['Costo/bulto entregado $', 'costPerDeliveredPackage', 24], ['Costo/kg entregado $', 'costPerDeliveredKg', 22],
    ['Devoluciones', 'returnRatio', 16], ['No atendidos', 'unattendedRatio', 16], ['Jornada h', 'hours', 14],
    ['Km/parada', 'kmPerStop', 14], ['Costo/km $', 'realCostPerKm', 16], ['Km/l cargado', 'fuelYield', 18],
    ['Km/l teorico', 'theoreticalFuelYield', 16], ['Viaticos $', 'allowances', 16], ['Alertas', 'alerts', 65],
  ];
  sheet.columns = columns.map(([header, key, width]) => ({ header, key, width }));
  for (const record of records) sheet.addRow({ ...record.trip, ...record.metrics, alerts: record.metrics.alerts.join(' | ') });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = `A1:AE${Math.max(1, sheet.rowCount)}`;
  for (const column of sheet.columns) {
    if (column.header.includes('$')) column.numFmt = '"$"#,##0.00';
    else if (['freightRatio', 'profitMargin', 'fillKg', 'fillPackages', 'returnRatio', 'unattendedRatio'].includes(column.key)) column.numFmt = '0.0%';
    else if (['hours', 'kmPerStop', 'fuelYield', 'theoreticalFuelYield'].includes(column.key)) column.numFmt = '0.00';
  }
  if (sheet.rowCount > 1) sheet.addConditionalFormatting({ ref: `K2:K${sheet.rowCount}`, rules: [
    { type: 'expression', formulae: ['$L2="verde"'], style: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } } } },
    { type: 'expression', formulae: ['$L2="amarillo"'], style: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB9C' } } } },
    { type: 'expression', formulae: ['$L2="rojo"'], style: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } } } },
  ] });
  const summary = workbook.addWorksheet('Resumen');
  summary.columns = [
    { header: 'Periodo', key: 'period', width: 16 }, { header: 'Grupo', key: 'group', width: 28 },
    { header: 'Viajes', key: 'trips', width: 12 }, { header: 'Costo total $', key: 'costTotal', width: 20 },
    { header: 'Venta entregada $', key: 'netSalesTotal', width: 22 }, { header: 'Flete ponderado', key: 'weightedRatio', width: 20 },
    { header: 'Sobrecosto $', key: 'excessTotal', width: 18 }, { header: 'Viajes rojos', key: 'redTripRatio', width: 18 },
    { header: 'Viajes incompletos', key: 'incompleteTrips', width: 22 },
  ];
  aggregates.forEach((group) => summary.addRow(group));
  for (const key of ['costTotal', 'netSalesTotal', 'excessTotal']) summary.getColumn(key).numFmt = '"$"#,##0.00';
  for (const key of ['weightedRatio', 'redTripRatio']) summary.getColumn(key).numFmt = '0.0%';
  const sources = workbook.addWorksheet('Parametros y notas');
  sources.columns = [{ header: 'Parametro', key: 'key', width: 40 }, { header: 'Valor', key: 'value', width: 75 }];
  sources.addRow({ key: 'Reporte', value: 'Snapshot semanal de KPIs calculados por el servidor. No reemplaza los datos del sistema.' });
  sources.addRow({ key: 'Ganancia', value: 'Venta entregada x margen antes de flete - costo. Estimacion, no utilidad contable.' });
  sources.addRow({ key: 'Combustible', value: 'Km/l cargado es orientativo; no mide necesariamente litros consumidos.' });
  sources.addRow({ key: 'Configuraciones historicas', value: 'Cada viaje cerrado conserva sus parametros; revisar configurationSnapshot en el sistema.' });
  Object.entries(configuration.settings).forEach(([key, value]) => sources.addRow({ key, value }));
  for (const type of configuration.vehicleTypes) sources.addRow({ key: `Vehiculo ${type.name}`, value: JSON.stringify(type) });
  for (const carrier of configuration.carriers) sources.addRow({ key: `Transportista ${carrier.name}`, value: JSON.stringify(carrier) });
  workbook.eachSheet((worksheet) => {
    worksheet.eachRow((row) => row.eachCell((cell) => { cell.font = { name: 'Arial', size: 10 }; }));
    worksheet.getRow(1).eachCell((cell) => { cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF20395E' } }; });
  });
  return workbook;
}

async function buildTripWorkbook(record) {
  const workbook = await buildWeeklyWorkbook([record], [], record.configuration);
  const { trip, route, metrics } = record;
  const addRows = (name, columns, rows) => {
    const sheet = workbook.addWorksheet(name);
    sheet.columns = columns.map(([header, key, width = 24]) => ({ header, key, width }));
    rows.forEach(row => sheet.addRow(row));
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    columns.forEach(([header, key]) => { if (header.includes('$')) sheet.getColumn(key).numFmt = '"$"#,##0.00'; });
    return sheet;
  };
  const detail = Object.entries(trip).filter(([, value]) => value == null || typeof value !== 'object' || value instanceof Date)
    .map(([key, value]) => ({ key, value: value instanceof Date ? value.toISOString() : value }));
  detail.push({ key: 'Estado actual ruta', value: record.currentRouteStatus }, { key: 'Origen ruta', value: record.routeSource },
    { key: 'Origen incidencias', value: record.issuesSource });
  for (const [key, value] of Object.entries(metrics)) detail.push({ key: `KPI ${key}`, value: Array.isArray(value) ? value.join(' | ') : value });
  for (const [key, value] of Object.entries(record.comparison || {})) detail.push({ key: `Comparativo ${key}`, value });
  if (trip.settledBy) detail.push({ key: 'Administrador que liquido', value: trip.settledBy.name || trip.settledBy.id });
  addRows('Liquidacion completa', [['Campo', 'key', 35], ['Valor', 'value', 85]], detail);
  addRows('Pedidos', [['Empresa', 'companyName', 35], ['Documento', 'orderNumber'], ['Fecha pedido', 'date'], ['Codigo cliente', 'clientId'], ['Cliente', 'clientName', 45],
    ['Sede', 'sucursal'], ['Monto cargado $', 'total'], ['Monto devuelto $', 'returned']], (trip.guideSnapshot?.orders || []).map((order, index) => ({
      ...order, companyName: order.companyName || order.company || 'Sin empresa registrada', returned: trip.returnedAmount === 0 ? 0 : (trip.returns || []).length
        ? (trip.returns || []).filter(item => item.orderIndex === index).reduce((sum, item) => sum + Math.round(item.amount * 100), 0) / 100 : null,
    })));
  const stopColumns = [['Orden', 'order', 12], ['Cliente', 'clientId'], ['Nombre', 'nombre', 40], ['Despachado (registro chofer)', 'dispatched', 30],
    ['Fecha despacho', 'dispatchedAt'], ['Peso', 'weight'], ['Datos completos', 'data', 90]];
  const stops = values => (values || []).map(stop => ({ ...stop, dispatchedAt: stop.dispatchedAt ? new Date(stop.dispatchedAt).toISOString() : null, data: JSON.stringify(stop) }));
  addRows('Paradas al liquidar', stopColumns, stops(route?.stops));
  addRows('Paradas originales', stopColumns, stops(route?.originalStops));
  addRows('Clientes no encontrados', [['Cliente', 'clientId'], ['Resuelto', 'resolved'], ['Datos completos', 'data', 90]],
    (route?.missingClients || []).map(item => ({ ...item, data: JSON.stringify(item) })));
  addRows('Devoluciones', [['Empresa', 'companyName', 35], ['Documento', 'orderNumber'], ['Cliente', 'clientId'], ['Nombre', 'clientName', 40], ['Sede', 'sucursal'],
    ['Monto devuelto $', 'amount'], ['Kg', 'kg'], ['Bultos', 'packages'], ['Motivo', 'reason', 60]], (trip.returns || []).map(item => ({
      ...item, companyName: item.companyName || trip.guideSnapshot?.orders?.[item.orderIndex]?.companyName || 'Sin empresa registrada',
    })));
  addRows('Incidencias', [['Documento', 'orderNumber'], ['Cliente', 'clientId'], ['Fecha', 'date'], ['Producto', 'productId'],
    ['Novedad', 'novelty', 50], ['Cantidad', 'quantity'], ['Presentacion', 'presentationType'], ['Reporte completo', 'data', 90]],
    record.issues.flatMap(issue => (issue.items?.length ? issue.items : [{}]).map(item => ({ ...item, orderNumber: issue.orderNumber,
      clientId: issue.clientId, date: issue.createdAt ? new Date(issue.createdAt).toISOString() : null, data: JSON.stringify(issue) }))));
  const applied = [];
  for (const [key, value] of Object.entries(record.configuration.settings)) applied.push({ group: 'Umbrales', key, value });
  for (const name of ['vehicleTypes', 'carriers', 'vehicles']) {
    for (const item of record.configuration[name] || []) for (const [key, value] of Object.entries(item)) applied.push({ group: `${name}: ${item.id}`, key, value });
  }
  addRows('Configuracion aplicada', [['Grupo', 'group', 35], ['Parametro', 'key', 30], ['Valor', 'value', 65]], applied);
  const routeDetails = Object.entries(route || {}).filter(([key]) => !['stops', 'originalStops', 'loadGuide', 'missingClients'].includes(key))
    .map(([key, value]) => ({ key, value: typeof value === 'object' && value !== null ? JSON.stringify(value) : value }));
  addRows('Datos de ruta', [['Campo', 'key', 35], ['Valor', 'value', 85]], routeDetails);
  workbook.eachSheet(sheet => {
    sheet.eachRow(row => row.eachCell(cell => { cell.font = { name: 'Arial', size: 10 }; }));
    sheet.getRow(1).eachCell(cell => { cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF20395E' } }; });
  });
  return workbook;
}

module.exports = { buildWeeklyWorkbook, buildTripWorkbook };
const text = (value) => String(value ?? '').trim();

function normalizeLoadGuide(input, stops, { companies = [], defaultCompanyId = '', requireCompany = false } = {}) {
  if (input == null) return null;
  const fail = (message) => { throw new Error(message); };
  const amount = (value) => {
    const parsed = Number(value);
    if (value === '' || value == null || !Number.isFinite(parsed) || parsed < 0
      || !Number.isSafeInteger(Math.round(parsed * 100))) {
      fail('Monto del pedido: ingresa un numero no negativo valido.');
    }
    return Math.round((parsed + Number.EPSILON) * 100) / 100;
  };
  const required = (value, label) => text(value) || fail(`${label} es obligatorio.`);
  const date = (value) => {
    const normalized = required(value, 'Fecha del pedido');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || !Number.isFinite(Date.parse(normalized))
      || new Date(normalized).toISOString().slice(0, 10) !== normalized) {
      fail('La fecha del pedido no es valida.');
    }
    return normalized;
  };
  if (!Array.isArray(input.orders) || !input.orders.length || input.orders.length > 200) {
    fail('La guia requiere entre 1 y 200 pedidos.');
  }
  const stopKey = (stop) => JSON.stringify([text(stop.clientId), text(stop.sucursal)]);
  const selectedClients = new Set(stops.map(stopKey));
  const registeredCompanies = new Map(companies.map(company => [String(company._id), company]));
  const seenOrders = new Set();
  const orders = input.orders.map((order) => {
    const clientId = required(order.clientId, 'Codigo del cliente');
    const sucursal = text(order.sucursal);
    if (!selectedClients.has(stopKey({ clientId, sucursal }))) fail(`El cliente ${clientId} y su sede no pertenecen a la ruta.`);
    const orderNumber = required(order.orderNumber, 'Numero de documento');
    const companyId = text(order.companyId) || text(defaultCompanyId);
    const company = registeredCompanies.get(companyId);
    if ((requireCompany || companyId) && !company) fail(`Selecciona una empresa registrada para el pedido ${orderNumber}.`);
    const key = JSON.stringify([companyId, clientId, sucursal, orderNumber.toUpperCase()]);
    if (seenOrders.has(key)) fail(`El documento ${orderNumber} esta repetido para el cliente ${clientId}.`);
    seenOrders.add(key);
    return {
      orderNumber, clientId, sucursal, date: date(order.date), total: amount(order.total),
      ...(company ? { companyId, companyName: company.name } : {}),
    };
  });
  for (const stop of stops) {
    if (!orders.some((order) => stopKey(order) === stopKey(stop))) {
      fail(`Falta un pedido para el cliente ${stop.clientId}${stop.sucursal ? ` (${stop.sucursal})` : ''}.`);
    }
  }
  return {
    orders,
    totalAmount: orders.reduce((sum, order) => sum + Math.round(order.total * 100), 0) / 100,
  };
}

module.exports = { normalizeLoadGuide };
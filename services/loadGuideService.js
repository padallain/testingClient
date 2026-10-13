const text = (value) => String(value ?? '').trim();

function normalizeLoadGuide(input, stops, { companies = [], defaultCompanyId = '', requireCompany = false, requireGuideIdentity = false } = {}) {
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
  const inputGuides = Array.isArray(input.subGuides) && input.subGuides.length
    ? input.subGuides
    : requireGuideIdentity ? [{ companyId: input.companyId, number: input.number, orders: input.orders }] : [];
  const guideByCompany = new Map();
  for (const guide of inputGuides) {
    const companyId = requireGuideIdentity ? required(guide.companyId, 'Empresa de la guia') : text(guide.companyId);
    const number = requireGuideIdentity ? required(guide.number, 'Numero de guia') : text(guide.number);
    if (!companyId || !number) continue;
    if (guideByCompany.has(companyId)) fail('Solo puede haber una guia por empresa dentro de la ruta.');
    guideByCompany.set(companyId, { companyId, number, numberKey: number.toUpperCase(), orders: [] });
  }
  const inputOrders = Array.isArray(input.subGuides) && input.subGuides.length
    ? inputGuides.flatMap(guide => (Array.isArray(guide.orders) ? guide.orders : []).map(order => ({ ...order, companyId: guide.companyId })))
    : input.orders;
  if (!Array.isArray(inputOrders) || !inputOrders.length || inputOrders.length > 200) {
    fail('La guia requiere entre 1 y 200 pedidos.');
  }
  const stopKey = (stop) => JSON.stringify([text(stop.clientId), text(stop.sucursal)]);
  const selectedClients = new Set(stops.map(stopKey));
  const registeredCompanies = new Map(companies.map(company => [String(company._id), company]));
  if (requireGuideIdentity && [...guideByCompany.keys()].some(companyId => !registeredCompanies.has(companyId))) {
    fail('Selecciona una empresa registrada para cada guia.');
  }
  const seenOrders = new Set();
  const orders = inputOrders.map((order) => {
    const clientId = required(order.clientId, 'Codigo del cliente');
    const sucursal = text(order.sucursal);
    if (!selectedClients.has(stopKey({ clientId, sucursal }))) fail(`El cliente ${clientId} y su sede no pertenecen a la ruta.`);
    const orderNumber = required(order.orderNumber, 'Numero de documento');
    const companyId = text(order.companyId) || text(defaultCompanyId);
    const company = registeredCompanies.get(companyId);
    if ((requireCompany || companyId) && !company) fail(`Selecciona una empresa registrada para el pedido ${orderNumber}.`);
    const guide = guideByCompany.get(companyId);
    if (requireGuideIdentity && !guide) fail(`Falta el numero de guia para ${company?.name || 'la empresa del pedido'}.`);
    const key = JSON.stringify([companyId, clientId, sucursal, orderNumber.toUpperCase()]);
    if (seenOrders.has(key)) fail(`El documento ${orderNumber} esta repetido para el cliente ${clientId}.`);
    seenOrders.add(key);
    const normalizedOrder = {
      orderNumber, clientId, sucursal, date: date(order.date), total: amount(order.total),
      ...(company ? { companyId, companyName: company.name } : {}),
    };
    guide?.orders.push(normalizedOrder);
    return normalizedOrder;
  });
  for (const stop of stops) {
    if (!orders.some((order) => stopKey(order) === stopKey(stop))) {
      fail(`Falta un pedido para el cliente ${stop.clientId}${stop.sucursal ? ` (${stop.sucursal})` : ''}.`);
    }
  }
  const subGuides = [...guideByCompany.values()].map(guide => ({
    ...guide,
    companyName: registeredCompanies.get(guide.companyId)?.name || '',
    totalAmount: guide.orders.reduce((sum, order) => sum + Math.round(order.total * 100), 0) / 100,
  }));
  return {
    ...(requireGuideIdentity ? {
      subGuides,
      number: subGuides.map(guide => guide.number).join(', '),
      ...(subGuides.length === 1 ? { numberKey: subGuides[0].numberKey, companyId: subGuides[0].companyId } : {}),
    } : {}),
    orders,
    totalAmount: orders.reduce((sum, order) => sum + Math.round(order.total * 100), 0) / 100,
  };
}

module.exports = { normalizeLoadGuide };
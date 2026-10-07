const { known, money } = require('./transportKpi.service');

function normalizeSettlement(value, guide) {
  const fail = message => { const error = new Error(message); error.statusCode = 400; throw error; };
  const outcome = value.deliveryOutcome;
  if (!['sin_novedad', 'con_devoluciones', 'con_novedades'].includes(outcome)) fail('Selecciona el resultado de la entrega.');
  if (!known(value.returnedAmount) || Number(value.returnedAmount) < 0) fail('Confirma el monto devuelto, incluso cuando sea cero.');
  if (!Array.isArray(value.returns || []) || (value.returns || []).length > 200) fail('Detalle de devoluciones invalido.');
  const totals = new Map();
  const returns = (value.returns || []).map(item => {
    const orderIndex = Number(item.orderIndex);
    const order = guide.orders[orderIndex];
    if (!Number.isInteger(orderIndex) || !order) fail('Pedido de devolucion invalido.');
    if (!known(item.amount) || Number(item.amount) <= 0) fail('Cada devolucion requiere un monto mayor que cero.');
    const amount = money(item.amount);
    if (amount <= 0) fail('La devolucion debe ser al menos $0.01.');
    const reason = String(item.reason || '').trim();
    if (!reason) fail('Indica el motivo de cada devolucion.');
    totals.set(orderIndex, (totals.get(orderIndex) || 0) + Math.round(amount * 100));
    if (totals.get(orderIndex) > Math.round(Number(order.total) * 100)) fail('La devolucion supera el monto del pedido.');
    const quantity = (input, integer = false) => {
      if (input == null || input === '') return null;
      if (!known(input) || Number(input) < 0 || (integer && !Number.isInteger(Number(input)))) fail('Cantidad devuelta invalida.');
      return Number(input);
    };
    return { orderIndex, orderNumber: order.orderNumber, clientId: order.clientId, clientName: order.clientName,
      companyId: order.companyId || null, companyName: order.companyName || order.company || null,
      sucursal: order.sucursal || '', amount, reason, kg: quantity(item.kg), packages: quantity(item.packages, true) };
  });
  const returnedAmount = money(value.returnedAmount);
  const sum = returns.reduce((total, item) => total + Math.round(item.amount * 100), 0) / 100;
  if (sum !== returnedAmount) fail('El detalle de devoluciones no coincide con el monto devuelto.');
  if (outcome === 'con_devoluciones' && (!returns.length || returnedAmount <= 0)) fail('Registra al menos una devolucion.');
  if (outcome !== 'con_devoluciones' && (returnedAmount !== 0 || returns.length)) fail('Selecciona con devoluciones para registrar importes devueltos.');
  for (const [unit, loaded, delivered] of [['kg', 'loadedKg', 'deliveredKg'], ['packages', 'loadedPackages', 'deliveredPackages']]) {
    if (returns.length && returns.every(item => known(item[unit])) && known(value[loaded])) {
      const returnedQuantity = returns.reduce((sum, item) => sum + Number(item[unit]), 0);
      if (returnedQuantity > Number(value[loaded]) + 1e-8
        || (known(value[delivered]) && returnedQuantity + Number(value[delivered]) > Number(value[loaded]) + 1e-8)) fail('Las cantidades entregadas y devueltas superan la carga.');
    }
  }
  if (outcome === 'sin_novedad') {
    if (!known(value.plannedStops) || !known(value.attendedStops) || Number(value.attendedStops) !== Number(value.plannedStops)) fail('Sin novedad requiere confirmar todas las paradas atendidas.');
    for (const [loaded, delivered] of [['loadedKg', 'deliveredKg'], ['loadedPackages', 'deliveredPackages']]) {
      if (known(value[loaded]) && (!known(value[delivered]) || Number(value[loaded]) !== Number(value[delivered]))) fail('Sin novedad requiere confirmar toda la carga entregada.');
    }
  }
  if (outcome === 'con_novedades' && !String(value.notes || '').trim()) fail('Describe las novedades en observaciones.');
  return { deliveryOutcome: outcome, returns };
}

module.exports = { normalizeSettlement };
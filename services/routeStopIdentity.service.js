const text = value => String(value ?? '').trim();
const coordinate = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? '' : Number(value);

function routeStopIdentity(stop) {
  const branch = text(stop?.sucursal);
  if (branch) return JSON.stringify([text(stop?.clientId ?? stop?.id), branch]);
  return JSON.stringify([text(stop?.clientId ?? stop?.id), '', text(stop?.nombre),
    coordinate(stop?.location?.latitude), coordinate(stop?.location?.longitude)]);
}

function normalizeRouteStops(stops, orders = []) {
  const unique = new Map();
  for (const value of Array.isArray(stops) ? stops : []) {
    const stop = value.toObject ? value.toObject() : { ...value };
    if (!text(stop.sucursal)) {
      const name = text(stop.nombre).toLocaleLowerCase('es');
      const branches = [...new Set(orders.filter(order => text(order.clientId) === text(stop.clientId)).map(order => text(order.sucursal)).filter(Boolean))];
      const matched = branches.filter(branch => name.endsWith(`(${branch.toLocaleLowerCase('es')})`)
        || name.endsWith(`\u2014 ${branch.toLocaleLowerCase('es')}`));
      if (matched.length === 1) stop.sucursal = matched[0];
    }
    const key = routeStopIdentity(stop);
    if (!unique.has(key)) unique.set(key, { ...stop, stopKey: key });
    else {
      const existing = unique.get(key);
      const bothDispatched = Boolean(existing.dispatched) && Boolean(stop.dispatched);
      existing.dispatched = bothDispatched;
      existing.dispatchedAt = bothDispatched ? existing.dispatchedAt || stop.dispatchedAt || null : null;
    }
  }
  return [...unique.values()].map((stop, index) => ({ ...stop, order: index + 1 }));
}

function normalizeDriverRoute(route) {
  if (!route) return route;
  const value = route.toObject ? route.toObject() : route;
  return { ...value, stops: normalizeRouteStops(value.stops, value.loadGuide?.orders), originalStops: normalizeRouteStops(value.originalStops, value.loadGuide?.orders) };
}

module.exports = { routeStopIdentity, normalizeRouteStops, normalizeDriverRoute };
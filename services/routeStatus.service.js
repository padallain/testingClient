const calculateRouteStatus = (assignment) => {
  const stops = Array.isArray(assignment?.stops) ? assignment.stops : [];
  const missingClients = Array.isArray(assignment?.missingClients) ? assignment.missingClients : [];
  const allStopsDispatched = stops.every((stop) => stop.dispatched);
  const allMissingResolved = missingClients.every((item) => item.resolved);

  return allStopsDispatched && allMissingResolved ? "completed" : "active";
};

const buildRouteDispatchStatusSummary = (assignment) => {
  const stops = Array.isArray(assignment?.stops) ? assignment.stops : [];
  const missingClients = Array.isArray(assignment?.missingClients) ? assignment.missingClients : [];
  const dispatchedCount = stops.filter((stop) => stop?.dispatched).length;
  const pendingStopsCount = Math.max(stops.length - dispatchedCount, 0);
  const resolvedMissingCount = missingClients.filter((item) => item?.resolved).length;
  const pendingMissingCount = Math.max(missingClients.length - resolvedMissingCount, 0);
  const totalClients = Number.isFinite(Number(assignment?.uniqueClientCount))
    ? Number(assignment.uniqueClientCount)
    : stops.length + missingClients.length;
  const completionUnits = stops.length + missingClients.length;
  const completedUnits = dispatchedCount + resolvedMissingCount;
  const completionPercentage = completionUnits > 0
    ? Math.round((completedUnits / completionUnits) * 100)
    : 0;

  return {
    routeId: assignment._id,
    routeLabel: assignment.routeLabel || "Ruta sin nombre",
    driverId: assignment.driverId || "",
    driverName: assignment.driverName || "",
    status: assignment.status || calculateRouteStatus({ stops, missingClients }),
    totalClients,
    totalStops: stops.length,
    dispatchedCount,
    pendingStopsCount,
    missingClientsCount: missingClients.length,
    resolvedMissingCount,
    pendingMissingCount,
    remainingCount: pendingStopsCount + pendingMissingCount,
    totalWeight: Number(assignment?.totalWeight) || 0,
    duplicateClientIds: Array.isArray(assignment?.duplicateClientIds) ? assignment.duplicateClientIds : [],
    createdAt: assignment?.createdAt || null,
    updatedAt: assignment?.updatedAt || null,
    completionPercentage,
  };
};

const buildRouteDispatchTotals = (routeStatuses) => routeStatuses.reduce((accumulator, route) => ({
  routes: accumulator.routes + 1,
  activeRoutes: accumulator.activeRoutes + (route.status === "active" ? 1 : 0),
  completedRoutes: accumulator.completedRoutes + (route.status === "completed" ? 1 : 0),
  totalClients: accumulator.totalClients + route.totalClients,
  dispatchedCount: accumulator.dispatchedCount + route.dispatchedCount,
  remainingCount: accumulator.remainingCount + route.remainingCount,
  pendingMissingCount: accumulator.pendingMissingCount + route.pendingMissingCount,
}), {
  routes: 0,
  activeRoutes: 0,
  completedRoutes: 0,
  totalClients: 0,
  dispatchedCount: 0,
  remainingCount: 0,
  pendingMissingCount: 0,
});

module.exports = {
  buildRouteDispatchStatusSummary,
  buildRouteDispatchTotals,
  calculateRouteStatus,
};
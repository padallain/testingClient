const Client = require("../models/client.model");
const RouteAssignment = require("../models/routeAssignment.model");
const DispatchIssueReport = require("../models/dispatchIssueReport.model");
const {
  buildMissingClients,
  buildOptimizedRoute,
  buildRouteOptions,
  buildRouteArtifacts,
  buildRouteLabel,
  calculateRouteDistance,
  normalizeRequestedStops,
  normalizeWeight,
} = require("../services/routePlanning.service");
const {
  hasInvalidDispatchIssueItems,
  normalizeDispatchIssueItems,
} = require("../services/dispatchIssue.service");
const {
  buildRouteDispatchStatusSummary,
  buildRouteDispatchTotals,
  calculateRouteStatus,
} = require("../services/routeStatus.service");

const mapStopsForArtifacts = (stops) => (Array.isArray(stops)
  ? stops.map((stop) => ({
      id: stop.clientId,
      nombre: stop.nombre,
      weight: stop.weight,
      location: stop.location,
    }))
  : []);

const buildAssignmentStops = (routeStops) => routeStops.map((client, index) => ({
  order: index + 1,
  clientId: client.id,
  nombre: client.nombre,
  weight: Number(client.weight) || 0,
  location: client.location,
  googleMapsLink: client.googleMapsLink,
  dispatched: false,
  dispatchedAt: null,
}));

const mergeStopProgress = (stops, progressSourceStops) => {
  const progressByClientId = new Map(
    (Array.isArray(progressSourceStops) ? progressSourceStops : []).map((stop) => [
      String(stop?.clientId || ""),
      {
        dispatched: Boolean(stop?.dispatched),
        dispatchedAt: stop?.dispatchedAt || null,
      },
    ]),
  );

  return stops.map((stop, index) => {
    const progress = progressByClientId.get(String(stop?.clientId || ""));

    return {
      ...stop,
      order: index + 1,
      dispatched: progress ? progress.dispatched : Boolean(stop?.dispatched),
      dispatchedAt: progress ? progress.dispatchedAt : stop?.dispatchedAt || null,
    };
  });
};

const buildRecommendedStopsFromAssignment = async (assignment) => {
  const currentStops = Array.isArray(assignment?.stops)
    ? assignment.stops.map((stop) => (stop.toObject ? stop.toObject() : stop))
    : [];

  if (currentStops.length === 0) {
    return [];
  }

  const optimizedRoute = await buildOptimizedRoute(currentStops.map((stop) => ({
    id: stop.clientId,
    nombre: stop.nombre,
    weight: stop.weight,
    location: stop.location,
  })));

  if (optimizedRoute.length === 0) {
    return [];
  }

  const stopsByClientId = new Map(currentStops.map((stop) => [String(stop.clientId), stop]));

  return optimizedRoute.map((client, index) => {
    const existingStop = stopsByClientId.get(String(client.id));

    return {
      ...existingStop,
      order: index + 1,
      clientId: client.id,
      nombre: client.nombre,
      weight: Number(client.weight) || 0,
      location: client.location,
      googleMapsLink: existingStop?.googleMapsLink
        || `https://www.google.com/maps?q=${client.location.latitude},${client.location.longitude}`,
    };
  });
};

const applyRouteArtifactsToAssignment = async (assignment, stops) => {
  const normalizedStops = mapStopsForArtifacts(stops);
  const { googleMapsRouteLinks, openRouteLink } = buildRouteArtifacts(normalizedStops);
  const totalDistanceKm = await calculateRouteDistance(normalizedStops);

  assignment.stops = stops.map((stop, index) => ({
    ...stop,
    order: index + 1,
  }));
  assignment.googleMapsRouteLinks = googleMapsRouteLinks;
  assignment.openRouteLink = openRouteLink;
  assignment.totalDistanceKm = totalDistanceKm;
};

const MONTH_QUERY_PATTERN = /^\d{4}-\d{2}$/;

const createMonthDateRange = (monthQuery) => {
  const selectedDate = typeof monthQuery === "string" && MONTH_QUERY_PATTERN.test(monthQuery)
    ? new Date(`${monthQuery}-01T00:00:00`)
    : new Date();

  const rangeStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
  const rangeEnd = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 1);

  return {
    selectedMonth: `${rangeStart.getFullYear()}-${String(rangeStart.getMonth() + 1).padStart(2, "0")}`,
    rangeStart,
    rangeEnd,
  };
};

const buildAnalyticsMonthLabel = (date) => date.toLocaleDateString("es-MX", {
  month: "short",
  year: "numeric",
});

const summarizeDriverAnalytics = (routes) => {
  const driversMap = new Map();

  routes.forEach((route) => {
    const driverId = String(route?.driverId || "SIN_CHOFER").trim() || "SIN_CHOFER";
    const driverName = String(route?.driverName || "").trim();
    const stops = Array.isArray(route?.stops) ? route.stops : [];
    const missingClients = Array.isArray(route?.missingClients) ? route.missingClients : [];
    const dispatchedCount = stops.filter((stop) => stop?.dispatched).length;
    const resolvedMissingCount = missingClients.filter((item) => item?.resolved).length;
    const assignedUnits = stops.length + missingClients.length;
    const completedUnits = dispatchedCount + resolvedMissingCount;
    const pendingUnits = Math.max(assignedUnits - completedUnits, 0);
    const routeStatus = route?.status || calculateRouteStatus(route);
    const currentDriver = driversMap.get(driverId) || {
      driverId,
      driverName: driverName || driverId,
      routeCount: 0,
      completedRoutes: 0,
      activeRoutes: 0,
      totalKg: 0,
      totalClients: 0,
      dispatchedCount: 0,
      resolvedMissingCount: 0,
      pendingCount: 0,
      totalDistanceKm: 0,
      assignedUnits: 0,
      completedUnits: 0,
      lastRouteAt: null,
    };

    currentDriver.routeCount += 1;
    currentDriver.completedRoutes += routeStatus === "completed" ? 1 : 0;
    currentDriver.activeRoutes += routeStatus === "active" ? 1 : 0;
    currentDriver.totalKg += Number(route?.totalWeight) || 0;
    currentDriver.totalClients += Number(route?.uniqueClientCount) || 0;
    currentDriver.dispatchedCount += dispatchedCount;
    currentDriver.resolvedMissingCount += resolvedMissingCount;
    currentDriver.pendingCount += pendingUnits;
    currentDriver.totalDistanceKm += Number(route?.totalDistanceKm) || 0;
    currentDriver.assignedUnits += assignedUnits;
    currentDriver.completedUnits += completedUnits;

    const routeDate = route?.updatedAt || route?.createdAt || null;

    if (!currentDriver.lastRouteAt || new Date(routeDate) > new Date(currentDriver.lastRouteAt)) {
      currentDriver.lastRouteAt = routeDate;
    }

    if (!currentDriver.driverName && driverName) {
      currentDriver.driverName = driverName;
    }

    driversMap.set(driverId, currentDriver);
  });

  return [...driversMap.values()]
    .map((driver) => ({
      ...driver,
      totalKg: Number(driver.totalKg.toFixed(2)),
      totalDistanceKm: Number(driver.totalDistanceKm.toFixed(2)),
      completionRate: driver.routeCount > 0
        ? Math.round((driver.completedRoutes / driver.routeCount) * 100)
        : 0,
      dispatchRate: driver.assignedUnits > 0
        ? Math.round((driver.completedUnits / driver.assignedUnits) * 100)
        : 0,
      avgKgPerRoute: driver.routeCount > 0
        ? Number((driver.totalKg / driver.routeCount).toFixed(2))
        : 0,
      avgClientsPerRoute: driver.routeCount > 0
        ? Number((driver.totalClients / driver.routeCount).toFixed(1))
        : 0,
      avgDistancePerRoute: driver.routeCount > 0
        ? Number((driver.totalDistanceKm / driver.routeCount).toFixed(2))
        : 0,
    }))
    .sort((currentDriver, nextDriver) => {
      if (nextDriver.completedRoutes !== currentDriver.completedRoutes) {
        return nextDriver.completedRoutes - currentDriver.completedRoutes;
      }

      if (nextDriver.totalKg !== currentDriver.totalKg) {
        return nextDriver.totalKg - currentDriver.totalKg;
      }

      return nextDriver.totalClients - currentDriver.totalClients;
    });
};

const buildAnalyticsOverview = (driverAnalytics, totalRoutes) => {
  const totals = driverAnalytics.reduce((accumulator, driver) => ({
    totalKg: accumulator.totalKg + driver.totalKg,
    totalClients: accumulator.totalClients + driver.totalClients,
    completedRoutes: accumulator.completedRoutes + driver.completedRoutes,
    activeRoutes: accumulator.activeRoutes + driver.activeRoutes,
    pendingCount: accumulator.pendingCount + driver.pendingCount,
    assignedUnits: accumulator.assignedUnits + driver.assignedUnits,
    completedUnits: accumulator.completedUnits + driver.completedUnits,
  }), {
    totalKg: 0,
    totalClients: 0,
    completedRoutes: 0,
    activeRoutes: 0,
    pendingCount: 0,
    assignedUnits: 0,
    completedUnits: 0,
  });

  return {
    drivers: driverAnalytics.length,
    routes: totalRoutes,
    totalKg: Number(totals.totalKg.toFixed(2)),
    totalClients: totals.totalClients,
    completedRoutes: totals.completedRoutes,
    activeRoutes: totals.activeRoutes,
    completionRate: totalRoutes > 0
      ? Math.round((totals.completedRoutes / totalRoutes) * 100)
      : 0,
    dispatchRate: totals.assignedUnits > 0
      ? Math.round((totals.completedUnits / totals.assignedUnits) * 100)
      : 0,
    pendingCount: totals.pendingCount,
    avgKgPerDriver: driverAnalytics.length > 0
      ? Number((totals.totalKg / driverAnalytics.length).toFixed(2))
      : 0,
    avgClientsPerDriver: driverAnalytics.length > 0
      ? Number((totals.totalClients / driverAnalytics.length).toFixed(1))
      : 0,
  };
};

const buildMonthlyAnalyticsHistory = (routes, selectedMonthStart) => {
  const historyMonths = Array.from({ length: 6 }, (_, index) => {
    const monthDate = new Date(selectedMonthStart.getFullYear(), selectedMonthStart.getMonth() - (5 - index), 1);

    return {
      key: `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`,
      label: buildAnalyticsMonthLabel(monthDate),
      date: monthDate,
      routes: 0,
      completedRoutes: 0,
      totalKg: 0,
      totalClients: 0,
      activeDrivers: new Set(),
    };
  });

  const historyByMonth = new Map(historyMonths.map((month) => [month.key, month]));

  routes.forEach((route) => {
    const routeDate = route?.createdAt ? new Date(route.createdAt) : null;

    if (!routeDate || Number.isNaN(routeDate.getTime())) {
      return;
    }

    const monthKey = `${routeDate.getFullYear()}-${String(routeDate.getMonth() + 1).padStart(2, "0")}`;
    const monthBucket = historyByMonth.get(monthKey);

    if (!monthBucket) {
      return;
    }

    monthBucket.routes += 1;
    monthBucket.completedRoutes += route?.status === "completed" ? 1 : 0;
    monthBucket.totalKg += Number(route?.totalWeight) || 0;
    monthBucket.totalClients += Number(route?.uniqueClientCount) || 0;
    monthBucket.activeDrivers.add(String(route?.driverId || "SIN_CHOFER"));
  });

  return historyMonths.map((month) => ({
    month: month.key,
    label: month.label,
    routes: month.routes,
    completedRoutes: month.completedRoutes,
    totalKg: Number(month.totalKg.toFixed(2)),
    totalClients: month.totalClients,
    activeDrivers: month.activeDrivers.size,
    completionRate: month.routes > 0
      ? Math.round((month.completedRoutes / month.routes) * 100)
      : 0,
  }));
};

const makeRoute = async (req, res) => {
  try {
    const { ids, stops, driverId, driverName, routeLabel, routeType } = req.body;
    const routeWeight = normalizeWeight(req.body?.routeWeight);
    const anchorClientId = typeof req.body?.anchorClientId === "string" ? req.body.anchorClientId.trim() : null;
    const { normalizedStops, uniqueStops, duplicateClientIds } = normalizeRequestedStops({ ids, stops });

    if (!Array.isArray(normalizedStops)) {
      return res
        .status(400)
        .json({ message: "Invalid input, expected an array of stops" });
    }

    if (uniqueStops.length === 0) {
      return res.status(400).json({ message: "At least one valid client ID is required" });
    }

    // Query each stop individually so branch clients fetch only the selected sede
    const clientQueryConditions = uniqueStops.map((stop) =>
      stop.sucursal
        ? { id: stop.clientId, sucursal: stop.sucursal }
        : { id: stop.clientId },
    );
    const clients = await Client.find({ $or: clientQueryConditions }).lean();

    // Detect missing stops using (id + sucursal) as the compound key
    const foundStopKeys = new Set(
      clients.map((c) => (c.sucursal ? `${c.id}|${c.sucursal}` : c.id)),
    );
    const notFoundClients = uniqueStops
      .filter((stop) => {
        const key = stop.sucursal ? `${stop.clientId}|${stop.sucursal}` : stop.clientId;
        return !foundStopKeys.has(key);
      })
      .map((stop) => ({
        clientId: stop.sucursal ? `${stop.clientId} (${stop.sucursal})` : stop.clientId,
        resolved: false,
        resolvedAt: null,
      }));
    const notFoundIds = notFoundClients.map((c) => c.clientId);
    const uniqueIds = uniqueStops.map((stop) => stop.clientId);
    const routeOptions = await buildRouteOptions(clients, { anchorClientId: anchorClientId || undefined });

    if (routeOptions.length < 1) {
      return res
        .status(400)
        .json({
          message: "At least one client with valid coordinates is required",
          notFoundIds,
          notFoundClients,
        });
    }

    const normalizedRouteType = String(routeType || "").trim().toLowerCase();
    const recommendedRouteOption = routeOptions[0];
    const selectedRouteOption = routeOptions.find((option) => option.type === normalizedRouteType) || recommendedRouteOption;
    const { response, googleMapsRouteLinks, openRouteLink } = buildRouteArtifacts(selectedRouteOption.route);
    const responseRouteOptions = routeOptions.map((option) => {
      const optionArtifacts = buildRouteArtifacts(option.route);

      return {
        type: option.type,
        label: option.label,
        description: option.description,
        estimatedDistanceKm: option.estimatedDistanceKm,
        route: optionArtifacts.response,
        routeNames: optionArtifacts.response.map((client) => client.nombre),
        googleMapsRouteLinks: optionArtifacts.googleMapsRouteLinks,
        openRouteLink: optionArtifacts.openRouteLink,
      };
    });
    const totalWeight = routeWeight;
    const totalDistanceKm = selectedRouteOption.estimatedDistanceKm;
    const uniqueClientCount = uniqueStops.length;
    const normalizedDriverId = String(driverId || "").trim();

    let savedRoute = null;

    if (normalizedDriverId) {
      const assignmentStops = buildAssignmentStops(response);
      const recommendedArtifacts = buildRouteArtifacts(recommendedRouteOption.route);
      const recommendedAssignmentStops = buildAssignmentStops(recommendedArtifacts.response);
      const assignment = new RouteAssignment({
        driverId: normalizedDriverId,
        driverName: typeof driverName === "string" ? driverName.trim() : "",
        routeLabel: buildRouteLabel({ driverId: normalizedDriverId, requestedLabel: routeLabel }),
        routeType: selectedRouteOption.type,
        routeTypeLabel: selectedRouteOption.label,
        uniqueClientCount,
        totalWeight,
        totalDistanceKm,
        duplicateClientIds: [...new Set(duplicateClientIds)],
        googleMapsRouteLinks,
        openRouteLink,
        originalTotalDistanceKm: recommendedRouteOption.estimatedDistanceKm,
        originalGoogleMapsRouteLinks: recommendedArtifacts.googleMapsRouteLinks,
        originalOpenRouteLink: recommendedArtifacts.openRouteLink,
        status: notFoundClients.length === 0 && response.every((stop) => stop.dispatched)
          ? "completed"
          : "active",
        stops: assignmentStops,
        originalStops: recommendedAssignmentStops,
        missingClients: notFoundClients,
      });

      assignment.routeLabel = buildRouteLabel({
        routeId: assignment._id,
        driverId: normalizedDriverId,
        requestedLabel: routeLabel,
      });

      await assignment.save();

      savedRoute = {
        routeId: assignment._id,
        driverId: assignment.driverId,
        driverName: assignment.driverName,
        routeLabel: assignment.routeLabel,
        routeType: selectedRouteOption.type,
        routeTypeLabel: selectedRouteOption.label,
        totalDistanceKm: assignment.totalDistanceKm,
        status: assignment.status,
      };
    }

    res.status(200).json({
      route: response,
      routeNames: response.map((client) => client.nombre),
      routeType: selectedRouteOption.type,
      routeTypeLabel: selectedRouteOption.label,
      routeOptions: responseRouteOptions,
      googleMapsRouteLinks,
      openRouteLink,
      notFoundIds,
      notFoundClients,
      duplicateClientIds: [...new Set(duplicateClientIds)],
      uniqueClientCount,
      totalWeight,
      totalDistanceKm,
      savedRoute,
    });
  } catch (err) {
    console.log("Error al calcular la ruta logística:", err);
    res.status(500).json({ message: "Error calculating route" });
  }
};

const getDriverCurrentRoute = async (req, res) => {
  try {
    const { driverId } = req.params;

    if (!driverId) {
      return res.status(400).json({ message: "Driver ID is required" });
    }

    const normalizedDriverId = String(driverId).trim();
    const activeRoutes = await RouteAssignment.find({ driverId: normalizedDriverId, status: "active" })
      .sort({ createdAt: -1 })
      .lean();

    const latestRoute = activeRoutes[0] || await RouteAssignment.findOne({ driverId: normalizedDriverId })
      .sort({ createdAt: -1 })
      .lean();

    if (!latestRoute) {
      return res.status(404).json({ message: "No route found for this driver" });
    }

    res.status(200).json({
      route: latestRoute,
      routes: activeRoutes.length > 0 ? activeRoutes : [latestRoute],
    });
  } catch (err) {
    console.log("Error obteniendo ruta del chofer:", err);
    res.status(500).json({ message: "Error getting driver route" });
  }
};

const listRouteAssignments = async (_req, res) => {
  try {
    const routes = await RouteAssignment.find()
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({ routes });
  } catch (err) {
    console.log("Error obteniendo rutas guardadas:", err);
    res.status(500).json({ message: "Error getting saved routes" });
  }
};

const listRouteDispatchStatuses = async (_req, res) => {
  try {
    const routes = await RouteAssignment.find()
      .sort({ status: 1, createdAt: -1 })
      .lean();

    const routeStatuses = routes.map((route) => buildRouteDispatchStatusSummary(route));
    const totals = buildRouteDispatchTotals(routeStatuses);

    res.status(200).json({
      routes: routeStatuses,
      totals,
    });
  } catch (err) {
    console.log("Error obteniendo estatus de despachos:", err);
    res.status(500).json({ message: "Error getting route dispatch statuses" });
  }
};

const getDriverPerformanceAnalytics = async (req, res) => {
  try {
    const { selectedMonth, rangeStart, rangeEnd } = createMonthDateRange(req.query?.month);
    const historyRangeStart = new Date(rangeStart.getFullYear(), rangeStart.getMonth() - 5, 1);

    const routes = await RouteAssignment.find({
      createdAt: {
        $gte: historyRangeStart,
        $lt: rangeEnd,
      },
    })
      .sort({ createdAt: -1 })
      .lean();

    const currentMonthRoutes = routes.filter((route) => {
      const routeDate = route?.createdAt ? new Date(route.createdAt) : null;

      return routeDate && routeDate >= rangeStart && routeDate < rangeEnd;
    });

    const drivers = summarizeDriverAnalytics(currentMonthRoutes);
    const overview = buildAnalyticsOverview(drivers, currentMonthRoutes.length);
    const monthlyHistory = buildMonthlyAnalyticsHistory(routes, rangeStart);

    res.status(200).json({
      month: selectedMonth,
      period: {
        start: rangeStart,
        end: rangeEnd,
        label: buildAnalyticsMonthLabel(rangeStart),
      },
      overview,
      drivers,
      monthlyHistory,
      topDriver: drivers[0] || null,
    });
  } catch (err) {
    console.log("Error obteniendo analitica de choferes:", err);
    res.status(500).json({ message: "Error getting driver performance analytics" });
  }
};

const updateRouteAssignment = async (req, res) => {
  try {
    const { routeId } = req.params;
    const { driverId, driverName, routeLabel, totalWeight, status } = req.body;

    if (!routeId) {
      return res.status(400).json({ message: "Route ID is required" });
    }

    const assignment = await RouteAssignment.findById(routeId);

    if (!assignment) {
      return res.status(404).json({ message: "Route not found" });
    }

    const normalizedDriverId = String(driverId || "").trim();
    const normalizedDriverName = String(driverName || "").trim();
    const normalizedRouteLabel = String(routeLabel || "").trim();
    const normalizedTotalWeight = normalizeWeight(totalWeight);
    const normalizedStatus = String(status || "").trim().toLowerCase();

    if (!normalizedDriverId || !normalizedRouteLabel) {
      return res.status(400).json({ message: "Driver ID and route label are required" });
    }

    if (!["active", "completed"].includes(normalizedStatus)) {
      return res.status(400).json({ message: "Status must be active or completed" });
    }

    assignment.driverId = normalizedDriverId;
    assignment.driverName = normalizedDriverName;
    assignment.routeLabel = normalizedRouteLabel;
    assignment.totalWeight = normalizedTotalWeight;
    assignment.status = normalizedStatus;

    await assignment.save();

    await DispatchIssueReport.updateMany(
      { routeId: assignment._id },
      {
        $set: {
          routeLabel: assignment.routeLabel,
          driverId: assignment.driverId,
          driverName: assignment.driverName,
        },
      },
    );

    res.status(200).json({
      message: "Route updated successfully",
      route: assignment,
    });
  } catch (err) {
    console.log("Error actualizando ruta guardada:", err);
    res.status(500).json({ message: "Error updating saved route" });
  }
};

const deleteRouteAssignment = async (req, res) => {
  try {
    const { routeId } = req.params;

    if (!routeId) {
      return res.status(400).json({ message: "Route ID is required" });
    }

    const deletedRoute = await RouteAssignment.findByIdAndDelete(routeId);

    if (!deletedRoute) {
      return res.status(404).json({ message: "Route not found" });
    }

    await DispatchIssueReport.deleteMany({ routeId: deletedRoute._id });

    res.status(200).json({
      message: "Route deleted successfully",
      route: deletedRoute,
    });
  } catch (err) {
    console.log("Error eliminando ruta guardada:", err);
    res.status(500).json({ message: "Error deleting saved route" });
  }
};

const updateStopDispatchStatus = async (req, res) => {
  try {
    const { routeId, clientId } = req.params;
    const dispatched = Boolean(req.body?.dispatched);

    const assignment = await RouteAssignment.findById(routeId);

    if (!assignment) {
      return res.status(404).json({ message: "Route not found" });
    }

    const stop = assignment.stops.find((item) => item.clientId === clientId);

    if (!stop) {
      return res.status(404).json({ message: "Stop not found in route" });
    }

    stop.dispatched = dispatched;
    stop.dispatchedAt = dispatched ? new Date() : null;
    assignment.status = calculateRouteStatus(assignment);
    await assignment.save();

    res.status(200).json({
      message: "Stop updated successfully",
      route: assignment,
    });
  } catch (err) {
    console.log("Error actualizando despacho del cliente:", err);
    res.status(500).json({ message: "Error updating stop dispatch status" });
  }
};

const customizeDriverRoute = async (req, res) => {
  try {
    const { routeId } = req.params;
    const submittedStops = Array.isArray(req.body?.stops) ? req.body.stops : [];

    if (!routeId) {
      return res.status(400).json({ message: "Route ID is required" });
    }

    if (submittedStops.length === 0) {
      return res.status(400).json({ message: "At least one stop is required to update the route" });
    }

    const assignment = await RouteAssignment.findById(routeId);

    if (!assignment) {
      return res.status(404).json({ message: "Route not found" });
    }

    const currentStopsById = new Map(
      assignment.stops.map((stop) => [String(stop.clientId), stop.toObject ? stop.toObject() : stop]),
    );
    const nextStops = [];

    for (const rawStop of submittedStops) {
      const clientId = String(rawStop?.clientId || "").trim();

      if (!clientId || !currentStopsById.has(clientId)) {
        return res.status(400).json({ message: `Stop ${clientId || "unknown"} is not part of the assigned route` });
      }

      nextStops.push(currentStopsById.get(clientId));
      currentStopsById.delete(clientId);
    }

    if (currentStopsById.size > 0) {
      return res.status(400).json({ message: "The customized route must include all assigned stops" });
    }

    await applyRouteArtifactsToAssignment(assignment, nextStops);
    assignment.wasDriverModified = true;
    assignment.driverModifiedAt = new Date();
    assignment.status = calculateRouteStatus(assignment);
    await assignment.save();

    res.status(200).json({
      message: "Route customized successfully",
      route: assignment,
    });
  } catch (err) {
    console.log("Error personalizando ruta del chofer:", err);
    res.status(500).json({ message: "Error customizing driver route" });
  }
};

const resetDriverRoute = async (req, res) => {
  try {
    const { routeId } = req.params;

    if (!routeId) {
      return res.status(400).json({ message: "Route ID is required" });
    }

    const assignment = await RouteAssignment.findById(routeId);

    if (!assignment) {
      return res.status(404).json({ message: "Route not found" });
    }

    let originalStops = Array.isArray(assignment.originalStops)
      ? assignment.originalStops.map((stop) => (stop.toObject ? stop.toObject() : stop))
      : [];

    if (originalStops.length === 0) {
      originalStops = await buildRecommendedStopsFromAssignment(assignment);

      if (originalStops.length === 0) {
        return res.status(400).json({ message: "This route does not have a recommended version to restore" });
      }

      assignment.originalStops = originalStops;
      assignment.originalGoogleMapsRouteLinks = [];
      assignment.originalOpenRouteLink = "";
      assignment.originalTotalDistanceKm = await calculateRouteDistance(mapStopsForArtifacts(originalStops));
    }

    const restoredStops = mergeStopProgress(originalStops, assignment.stops);
    await applyRouteArtifactsToAssignment(assignment, restoredStops);
    assignment.originalGoogleMapsRouteLinks = assignment.googleMapsRouteLinks;
    assignment.originalOpenRouteLink = assignment.openRouteLink;
    assignment.originalTotalDistanceKm = assignment.totalDistanceKm;
    assignment.routeType = "closest";
    assignment.routeTypeLabel = "Mas cercana";
    assignment.wasDriverModified = false;
    assignment.driverModifiedAt = null;
    assignment.status = calculateRouteStatus(assignment);
    await assignment.save();

    res.status(200).json({
      message: "Route restored successfully",
      route: assignment,
    });
  } catch (err) {
    console.log("Error restaurando ruta del chofer:", err);
    res.status(500).json({ message: "Error restoring driver route" });
  }
};

const updateMissingClientResolution = async (req, res) => {
  try {
    const { routeId, clientId } = req.params;
    const resolved = Boolean(req.body?.resolved);

    const assignment = await RouteAssignment.findById(routeId);

    if (!assignment) {
      return res.status(404).json({ message: "Route not found" });
    }

    const missingClient = assignment.missingClients.find((item) => item.clientId === clientId);

    if (!missingClient) {
      return res.status(404).json({ message: "Missing client not found in route" });
    }

    missingClient.resolved = resolved;
    missingClient.resolvedAt = resolved ? new Date() : null;
    assignment.status = calculateRouteStatus(assignment);
    await assignment.save();

    res.status(200).json({
      message: "Missing client updated successfully",
      route: assignment,
    });
  } catch (err) {
    console.log("Error actualizando cliente no encontrado:", err);
    res.status(500).json({ message: "Error updating missing client" });
  }
};

const createDispatchIssueReport = async (req, res) => {
  try {
    const { routeId, clientId } = req.params;
    const { orderNumber, items, productId, novelty, presentationType, quantity } = req.body;

    const normalizedOrderNumber = String(orderNumber || "").trim();
    const normalizedItems = normalizeDispatchIssueItems(items, { productId, novelty, presentationType, quantity });

    if (!routeId || !clientId || !normalizedOrderNumber || normalizedItems.length === 0) {
      return res.status(400).json({
        message: "Route ID, client ID, order number and at least one product issue are required",
      });
    }

    const hasInvalidItem = hasInvalidDispatchIssueItems(normalizedItems);

    if (hasInvalidItem) {
      return res.status(400).json({
        message: "Each product issue must include product ID, novelty, presentation type caja|unidad and a quantity of at least 1",
      });
    }

    const assignment = await RouteAssignment.findById(routeId);

    if (!assignment) {
      return res.status(404).json({ message: "Route not found" });
    }

    const stop = assignment.stops.find((item) => item.clientId === clientId);

    if (!stop) {
      return res.status(404).json({ message: "Stop not found in route" });
    }

    const report = new DispatchIssueReport({
      routeId: assignment._id,
      routeLabel: assignment.routeLabel,
      driverId: assignment.driverId,
      driverName: assignment.driverName,
      clientId: stop.clientId,
      clientName: stop.nombre,
      stopOrder: stop.order,
      orderNumber: normalizedOrderNumber,
      items: normalizedItems,
    });

    await report.save();

    res.status(201).json({
      message: "Dispatch issue report registered successfully",
      reportId: report._id,
      report,
    });
  } catch (err) {
    console.log("Error registrando novedad de despacho:", err);
    res.status(500).json({ message: "Error registering dispatch issue report" });
  }
};

const updateDispatchIssueReport = async (req, res) => {
  try {
    const { reportId } = req.params;
    const { orderNumber, items, productId, novelty, presentationType, quantity } = req.body;

    if (!reportId) {
      return res.status(400).json({ message: "Report ID is required" });
    }

    const normalizedOrderNumber = String(orderNumber || "").trim();
    const normalizedItems = normalizeDispatchIssueItems(items, { productId, novelty, presentationType, quantity });

    if (!normalizedOrderNumber || normalizedItems.length === 0) {
      return res.status(400).json({
        message: "Order number and at least one product issue are required",
      });
    }

    if (hasInvalidDispatchIssueItems(normalizedItems)) {
      return res.status(400).json({
        message: "Each product issue must include product ID, novelty, presentation type caja|unidad and a quantity of at least 1",
      });
    }

    const report = await DispatchIssueReport.findById(reportId);

    if (!report) {
      return res.status(404).json({ message: "Dispatch issue report not found" });
    }

    report.orderNumber = normalizedOrderNumber;
    report.items = normalizedItems;

    await report.save();

    res.status(200).json({
      message: "Dispatch issue report updated successfully",
      report,
    });
  } catch (err) {
    console.log("Error actualizando novedad de despacho:", err);
    res.status(500).json({ message: "Error updating dispatch issue report" });
  }
};

const deleteDispatchIssueReport = async (req, res) => {
  try {
    const { reportId } = req.params;

    if (!reportId) {
      return res.status(400).json({ message: "Report ID is required" });
    }

    const deletedReport = await DispatchIssueReport.findByIdAndDelete(reportId);

    if (!deletedReport) {
      return res.status(404).json({ message: "Dispatch issue report not found" });
    }

    res.status(200).json({
      message: "Dispatch issue report deleted successfully",
      report: deletedReport,
    });
  } catch (err) {
    console.log("Error eliminando novedad de despacho:", err);
    res.status(500).json({ message: "Error deleting dispatch issue report" });
  }
};

const listDispatchIssueReports = async (_req, res) => {
  try {
    const reports = await DispatchIssueReport.find()
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({ reports });
  } catch (err) {
    console.log("Error obteniendo novedades de despacho:", err);
    res.status(500).json({ message: "Error getting dispatch issue reports" });
  }
};

const getRouteDispatchIssueSummary = async (req, res) => {
  try {
    const { routeId } = req.params;

    if (!routeId) {
      return res.status(400).json({ message: "Route ID is required" });
    }

    const assignment = await RouteAssignment.findById(routeId).lean();

    if (!assignment) {
      return res.status(404).json({ message: "Route not found" });
    }

    const reports = await DispatchIssueReport.find({ routeId: assignment._id })
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      route: {
        routeId: assignment._id,
        routeLabel: assignment.routeLabel,
        driverId: assignment.driverId,
        driverName: assignment.driverName,
        status: assignment.status,
        uniqueClientCount: assignment.uniqueClientCount,
        totalWeight: assignment.totalWeight,
      },
      reports,
    });
  } catch (err) {
    console.log("Error obteniendo resumen de novedades por ruta:", err);
    res.status(500).json({ message: "Error getting route dispatch issue summary" });
  }
};

module.exports = {
  makeRoute,
  getDriverCurrentRoute,
  listRouteAssignments,
  listRouteDispatchStatuses,
  getDriverPerformanceAnalytics,
  updateRouteAssignment,
  deleteRouteAssignment,
  updateStopDispatchStatus,
  customizeDriverRoute,
  resetDriverRoute,
  updateMissingClientResolution,
  createDispatchIssueReport,
  updateDispatchIssueReport,
  deleteDispatchIssueReport,
  listDispatchIssueReports,
  getRouteDispatchIssueSummary,
};

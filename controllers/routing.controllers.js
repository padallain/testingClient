const Client = require("../models/client.model");
const RouteAssignment = require("../models/routeAssignment.model");
const DispatchIssueReport = require("../models/dispatchIssueReport.model");

const ORIGIN = { latitude: 10.578208693113535, longitude: -71.67338068775426 };
const START_ID = "317554345";

const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const toRadians = (degrees) => degrees * (Math.PI / 180);
  const R = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const MAX_WAYPOINTS = 10;

const normalizeWeight = (value) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return 0;
  }

  return numericValue;
};

const buildRouteLabel = (driverId, requestedLabel) => {
  const normalizedLabel = typeof requestedLabel === "string" ? requestedLabel.trim() : "";

  if (normalizedLabel) {
    return normalizedLabel;
  }

  const dateTag = new Date().toISOString().slice(0, 10);
  return `Ruta ${driverId} ${dateTag}`;
};

const buildRouteArtifacts = (route) => {
  const response = route.map((client) => ({
    id: client.id,
    nombre: client.nombre,
    weight: client.weight,
    location: client.location,
    googleMapsLink: `https://www.google.com/maps?q=${client.location.latitude},${client.location.longitude}`,
  }));

  const googleMapsRouteLinks = [];
  let startPoint = `${ORIGIN.latitude},${ORIGIN.longitude}`;

  for (let i = 0; i < route.length; i += MAX_WAYPOINTS - 1) {
    const segment = route.slice(i, i + (MAX_WAYPOINTS - 1));
    const waypoints = [
      startPoint,
      ...segment.map(
        (client) => `${client.location.latitude},${client.location.longitude}`,
      ),
    ].join("/");
    googleMapsRouteLinks.push(`https://www.google.com/maps/dir/${waypoints}`);

    const lastClient = segment[segment.length - 1];
    if (lastClient) {
      startPoint = `${lastClient.location.latitude},${lastClient.location.longitude}`;
    }
  }

  const coordinates = [
    [ORIGIN.longitude, ORIGIN.latitude],
    ...route.map((client) => [client.location.longitude, client.location.latitude]),
  ];
  const aParam = coordinates.map(([lng, lat]) => `${lat},${lng}`).join(",");
  const first = coordinates[0];
  const openRouteLink = `https://maps.openrouteservice.org/directions?n1=${first[1]}&n2=${first[0]}&a=${aParam}&b=0&c=0&k1=en-US&k2=km`;

  return {
    response,
    googleMapsRouteLinks,
    openRouteLink,
  };
};

const calculateRouteStatus = (assignment) => {
  const allStopsDispatched = assignment.stops.every((stop) => stop.dispatched);
  const allMissingResolved = assignment.missingClients.every((item) => item.resolved);

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

const normalizeDispatchIssueItems = (items, fallbackItem) => {
  const rawItems = Array.isArray(items) && items.length > 0
    ? items
    : [fallbackItem];

  return rawItems
    .map((item) => ({
      productId: String(item?.productId || "").trim(),
      novelty: String(item?.novelty || "").trim(),
      presentationType: String(item?.presentationType || "").trim().toLowerCase(),
      quantity: Number(item?.quantity),
    }))
    .filter((item) => item.productId || item.novelty || item.presentationType || Number.isFinite(item.quantity));
};

const hasInvalidDispatchIssueItems = (items) => items.some((item) => {
  if (!item.productId || !item.novelty) {
    return true;
  }

  if (!["caja", "unidad"].includes(item.presentationType)) {
    return true;
  }

  return !Number.isInteger(item.quantity) || item.quantity < 1;
});

const makeRoute = async (req, res) => {
  try {
    const { ids, stops, driverId, driverName, routeLabel } = req.body;
      const routeWeight = normalizeWeight(req.body?.routeWeight);

    const normalizedStops = Array.isArray(stops)
      ? stops
      : Array.isArray(ids)
        ? ids.map((id) => ({ clientId: id }))
        : null;

    if (!Array.isArray(normalizedStops)) {
      return res
        .status(400)
        .json({ message: "Invalid input, expected an array of stops" });
    }

    const aggregatedStops = new Map();
    const duplicateClientIds = [];

    normalizedStops.forEach((rawStop) => {
      const clientId = String(rawStop?.clientId ?? rawStop?.id ?? "").trim();

      if (!clientId) {
        return;
      }
      const existingStop = aggregatedStops.get(clientId);

      if (existingStop) {
        duplicateClientIds.push(clientId);
        return;
      }

      aggregatedStops.set(clientId, {
        clientId,
      });
    });

    const uniqueStops = Array.from(aggregatedStops.values());

    if (uniqueStops.length === 0) {
      return res.status(400).json({ message: "At least one valid client ID is required" });
    }

    const uniqueIds = uniqueStops.map((stop) => stop.clientId);
    const clients = await Client.find({ id: { $in: uniqueIds } }).lean();

    const foundIds = clients.map((client) => client.id);
    const notFoundIds = uniqueIds.filter((id) => !foundIds.includes(id));
    const notFoundClients = notFoundIds.map((id) => ({
      clientId: id,
      resolved: false,
      resolvedAt: null,
    }));

    const clientsWithCoordinates = clients.filter(
      (client) =>
        client.location && Number.isFinite(client.location.latitude) && Number.isFinite(client.location.longitude)
    );

    if (clientsWithCoordinates.length < 1) {
      return res
        .status(400)
        .json({
          message: "At least one client with valid coordinates is required",
          notFoundIds,
          notFoundClients,
        });
    }

    const startClientIndex = clientsWithCoordinates.findIndex((client) => client.id === START_ID);
    let startClient = null;
    let restClients = clientsWithCoordinates;
    if (startClientIndex !== -1) {
      startClient = clientsWithCoordinates[startClientIndex];
      restClients = [
        ...clientsWithCoordinates.slice(0, startClientIndex),
        ...clientsWithCoordinates.slice(startClientIndex + 1)
      ];
    }

    let route = [];
    let currentPoint;
    if (startClient) {
      route.push({ ...startClient });
      currentPoint = route[0];
    } else {
      currentPoint = {
        location: ORIGIN,
      };
    }

    let unvisited = [...restClients];

    while (unvisited.length > 0) {
      let nearestIdx = 0;
      let minDist = calculateDistance(
        currentPoint.location.latitude,
        currentPoint.location.longitude,
        unvisited[0].location.latitude,
        unvisited[0].location.longitude
      );
      for (let i = 1; i < unvisited.length; i++) {
        const dist = calculateDistance(
          currentPoint.location.latitude,
          currentPoint.location.longitude,
          unvisited[i].location.latitude,
          unvisited[i].location.longitude
        );
        if (dist < minDist) {
          minDist = dist;
          nearestIdx = i;
        }
      }
      currentPoint = {
        ...unvisited[nearestIdx],
      };
      route.push(currentPoint);
      unvisited.splice(nearestIdx, 1);
    }

    const { response, googleMapsRouteLinks, openRouteLink } = buildRouteArtifacts(route);
    const totalWeight = routeWeight;
    const uniqueClientCount = uniqueStops.length;
    const normalizedDriverId = String(driverId || "").trim();

    let savedRoute = null;

    if (normalizedDriverId) {
      const assignment = new RouteAssignment({
        driverId: normalizedDriverId,
        driverName: typeof driverName === "string" ? driverName.trim() : "",
        routeLabel: buildRouteLabel(normalizedDriverId, routeLabel),
        uniqueClientCount,
        totalWeight,
        duplicateClientIds: [...new Set(duplicateClientIds)],
        googleMapsRouteLinks,
        openRouteLink,
        status: notFoundClients.length === 0 && response.every((stop) => stop.dispatched)
          ? "completed"
          : "active",
        stops: response.map((client, index) => ({
          order: index + 1,
          clientId: client.id,
          nombre: client.nombre,
          location: client.location,
          googleMapsLink: client.googleMapsLink,
          dispatched: false,
          dispatchedAt: null,
        })),
        missingClients: notFoundClients,
      });

      await assignment.save();

      savedRoute = {
        routeId: assignment._id,
        driverId: assignment.driverId,
        driverName: assignment.driverName,
        routeLabel: assignment.routeLabel,
        status: assignment.status,
      };
    }

    res.status(200).json({
      route: response,
      routeNames: response.map((client) => client.nombre),
      googleMapsRouteLinks,
      openRouteLink,
      notFoundIds,
      notFoundClients,
      duplicateClientIds: [...new Set(duplicateClientIds)],
      uniqueClientCount,
      totalWeight,
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
    const routeAssignment = await RouteAssignment.findOne({ driverId: normalizedDriverId, status: "active" })
      .sort({ createdAt: -1 })
      .lean();

    const latestRoute = routeAssignment || await RouteAssignment.findOne({ driverId: normalizedDriverId })
      .sort({ createdAt: -1 })
      .lean();

    if (!latestRoute) {
      return res.status(404).json({ message: "No route found for this driver" });
    }

    res.status(200).json({ route: latestRoute });
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
    const totals = routeStatuses.reduce((accumulator, route) => ({
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

    res.status(200).json({
      routes: routeStatuses,
      totals,
    });
  } catch (err) {
    console.log("Error obteniendo estatus de despachos:", err);
    res.status(500).json({ message: "Error getting route dispatch statuses" });
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
  updateRouteAssignment,
  deleteRouteAssignment,
  updateStopDispatchStatus,
  updateMissingClientResolution,
  createDispatchIssueReport,
  updateDispatchIssueReport,
  deleteDispatchIssueReport,
  listDispatchIssueReports,
  getRouteDispatchIssueSummary,
};

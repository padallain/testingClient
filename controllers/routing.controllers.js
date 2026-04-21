const Client = require("../models/client.model");
const RouteAssignment = require("../models/routeAssignment.model");
const DispatchIssueReport = require("../models/dispatchIssueReport.model");
const {
  buildMissingClients,
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

const applyRouteArtifactsToAssignment = (assignment, stops) => {
  const normalizedStops = mapStopsForArtifacts(stops);
  const { googleMapsRouteLinks, openRouteLink } = buildRouteArtifacts(normalizedStops);
  const totalDistanceKm = calculateRouteDistance(normalizedStops);

  assignment.stops = stops.map((stop, index) => ({
    ...stop,
    order: index + 1,
  }));
  assignment.googleMapsRouteLinks = googleMapsRouteLinks;
  assignment.openRouteLink = openRouteLink;
  assignment.totalDistanceKm = totalDistanceKm;
};

const makeRoute = async (req, res) => {
  try {
    const { ids, stops, driverId, driverName, routeLabel, routeType } = req.body;
    const routeWeight = normalizeWeight(req.body?.routeWeight);
    const { normalizedStops, uniqueStops, duplicateClientIds } = normalizeRequestedStops({ ids, stops });

    if (!Array.isArray(normalizedStops)) {
      return res
        .status(400)
        .json({ message: "Invalid input, expected an array of stops" });
    }

    if (uniqueStops.length === 0) {
      return res.status(400).json({ message: "At least one valid client ID is required" });
    }

    const uniqueIds = uniqueStops.map((stop) => stop.clientId);
    const clients = await Client.find({ id: { $in: uniqueIds } }).lean();

    const foundIds = clients.map((client) => client.id);
    const { notFoundIds, notFoundClients } = buildMissingClients(uniqueIds, foundIds);
    const routeOptions = buildRouteOptions(clients);

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
    const selectedRouteOption = routeOptions.find((option) => option.type === normalizedRouteType) || routeOptions[0];
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
      const assignment = new RouteAssignment({
        driverId: normalizedDriverId,
        driverName: typeof driverName === "string" ? driverName.trim() : "",
        routeLabel: buildRouteLabel(normalizedDriverId, routeLabel),
        routeType: selectedRouteOption.type,
        routeTypeLabel: selectedRouteOption.label,
        uniqueClientCount,
        totalWeight,
        totalDistanceKm,
        duplicateClientIds: [...new Set(duplicateClientIds)],
        googleMapsRouteLinks,
        openRouteLink,
        originalTotalDistanceKm: totalDistanceKm,
        originalGoogleMapsRouteLinks: googleMapsRouteLinks,
        originalOpenRouteLink: openRouteLink,
        status: notFoundClients.length === 0 && response.every((stop) => stop.dispatched)
          ? "completed"
          : "active",
        stops: assignmentStops,
        originalStops: assignmentStops,
        missingClients: notFoundClients,
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

    applyRouteArtifactsToAssignment(assignment, nextStops);
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

    const originalStops = Array.isArray(assignment.originalStops)
      ? assignment.originalStops.map((stop) => (stop.toObject ? stop.toObject() : stop))
      : [];

    if (originalStops.length === 0) {
      return res.status(400).json({ message: "This route does not have an original version to restore" });
    }

    assignment.stops = originalStops.map((stop, index) => ({
      ...stop,
      order: index + 1,
    }));
    assignment.googleMapsRouteLinks = Array.isArray(assignment.originalGoogleMapsRouteLinks)
      ? assignment.originalGoogleMapsRouteLinks
      : [];
    assignment.openRouteLink = assignment.originalOpenRouteLink || "";
    assignment.totalDistanceKm = Number(assignment.originalTotalDistanceKm) || 0;
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

const Client = require("../models/client.model");
const RouteAssignment = require("../models/routeAssignment.model");
const DispatchIssueReport = require("../models/dispatchIssueReport.model");
const {
  buildMissingClients,
  buildOptimizedRoute,
  buildRouteArtifacts,
  buildRouteLabel,
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

const makeRoute = async (req, res) => {
  try {
    const { ids, stops, driverId, driverName, routeLabel } = req.body;
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
    const route = buildOptimizedRoute(clients);

    if (route.length < 1) {
      return res
        .status(400)
        .json({
          message: "At least one client with valid coordinates is required",
          notFoundIds,
          notFoundClients,
        });
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

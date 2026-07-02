const Client = require("../models/client.model");
const ClientLocationReport = require("../models/clientLocationReport.model");

const registerClient = async (req, res) => {
  try {
    const { id, nombre, latitude, longitude, start, end, sucursal } = req.body;

    if (!id || !nombre || !latitude || !longitude || !start || !end) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const normalizedSucursal = typeof sucursal === 'string' ? sucursal.trim() : '';

    const existingClient = await Client.findOne({ id, sucursal: normalizedSucursal });
    if (existingClient) {
      const label = normalizedSucursal ? `(${normalizedSucursal})` : '';
      return res.status(400).json({ message: `Client with this ID ${label} already exists`.trim() });
    }

    const newClient = new Client({
      id,
      nombre,
      sucursal: normalizedSucursal,
      location: { latitude, longitude },
      schedule: { start, end },
    });

    await newClient.save();

    res.status(201).json({ message: 'Client registered successfully' });
  } catch (err) {
    console.log("Error en el registro del cliente:", err);
    res.status(500).json({ message: 'Error registering client' });
  }
};

const countClients = async (req, res) => {
  try {
    const count = await Client.countDocuments();
    res.status(200).json({ count });
  } catch (err) {
    console.log("Error contando clientes:", err);
    res.status(500).json({ message: "Error counting clients" });
  }
};

const buildClientResponse = (client) => {
  const hasValidCoordinates =
    client.location &&
    Number.isFinite(Number(client.location.latitude)) &&
    Number.isFinite(Number(client.location.longitude));

  return {
    ...client,
    googleMapsLink: hasValidCoordinates
      ? `https://www.google.com/maps?q=${client.location.latitude},${client.location.longitude}`
      : "",
  };
};

// Returns a single client. If the ID belongs to a chain, returns the first branch
// and includes a `esCadena: true` flag with `totalSedes` so the caller knows to
// use /getClient/:id/sedes for the full branch list.
const getClient = async (req, res) => {
  try {
    const { id } = req.params;

    const allBranches = await Client.find({ id }).lean();

    if (allBranches.length === 0) {
      return res.status(404).json({ message: "Client not found" });
    }

    if (allBranches.length === 1) {
      return res.status(200).json(buildClientResponse(allBranches[0]));
    }

    // Chain client — return all sedes so the caller can present a picker.
    return res.status(200).json({
      esCadena: true,
      id,
      nombre: allBranches[0].nombre,
      totalSedes: allBranches.length,
      sedes: allBranches.map(buildClientResponse),
    });
  } catch (err) {
    console.log("Error obteniendo cliente:", err);
    res.status(500).json({ message: "Error getting client" });
  }
};

// Returns all branches (sedes) of a chain client by ID.
const getClientBranches = async (req, res) => {
  try {
    const { id } = req.params;

    const branches = await Client.find({ id }).lean();

    if (branches.length === 0) {
      return res.status(404).json({ message: "Client not found" });
    }

    return res.status(200).json({
      id,
      nombre: branches[0].nombre,
      totalSedes: branches.length,
      esCadena: branches.length > 1,
      sedes: branches.map(buildClientResponse),
    });
  } catch (err) {
    console.log("Error obteniendo sedes:", err);
    res.status(500).json({ message: "Error getting client branches" });
  }
};

const deleteClient = async (req, res) => {
  try {
    const { id } = req.params;
    const { sucursal } = req.query;

    if (!id) {
      return res.status(400).json({ message: "Client ID is required" });
    }

    const query = sucursal !== undefined ? { id, sucursal: String(sucursal).trim() } : { id };
    const deletedClient = await Client.findOneAndDelete(query);

    if (!deletedClient) {
      return res.status(404).json({ message: "Client not found" });
    }

    res.status(200).json({
      message: "Client deleted successfully",
      client: deletedClient,
    });
  } catch (err) {
    console.log("Error eliminando cliente:", err);
    res.status(500).json({ message: "Error deleting client" });
  }
};

const createClientLocationReport = async (req, res) => {
  try {
    const { clientId, reporterName, details } = req.body;

    if (!clientId || !details) {
      return res.status(400).json({ message: "Client ID and details are required" });
    }

    const normalizedClientId = String(clientId).trim();
    const normalizedDetails = String(details).trim();

    if (!normalizedClientId || !normalizedDetails) {
      return res.status(400).json({ message: "Client ID and details are required" });
    }

    const client = await Client.findOne({ id: normalizedClientId });

    const report = new ClientLocationReport({
      clientId: normalizedClientId,
      reporterName: reporterName ? String(reporterName).trim() : "",
      details: normalizedDetails,
      clientFound: Boolean(client),
      clientSnapshot: client
        ? {
            id: client.id,
            nombre: client.nombre,
            location: client.location,
            schedule: client.schedule,
          }
        : undefined,
    });

    await report.save();

    res.status(201).json({
      message: "Client location report registered successfully",
      reportId: report._id,
      clientFound: report.clientFound,
    });
  } catch (err) {
    console.log("Error registrando denuncia de cliente:", err);
    res.status(500).json({ message: "Error registering client location report" });
  }
};

const listClientLocationReports = async (_req, res) => {
  try {
    const reports = await ClientLocationReport.find()
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({ reports });
  } catch (err) {
    console.log("Error obteniendo denuncias de clientes:", err);
    res.status(500).json({ message: "Error getting client location reports" });
  }
};

const deleteClientLocationReport = async (req, res) => {
  try {
    const { reportId } = req.params;

    if (!reportId) {
      return res.status(400).json({ message: "Report ID is required" });
    }

    const deletedReport = await ClientLocationReport.findByIdAndDelete(reportId);

    if (!deletedReport) {
      return res.status(404).json({ message: "Report not found" });
    }

    res.status(200).json({
      message: "Client location report deleted successfully",
      report: deletedReport,
    });
  } catch (err) {
    console.log("Error eliminando denuncia de cliente:", err);
    res.status(500).json({ message: "Error deleting client location report" });
  }
};

module.exports = {
  registerClient,
  countClients,
  getClient,
  getClientBranches,
  deleteClient,
  createClientLocationReport,
  listClientLocationReports,
  deleteClientLocationReport,
};

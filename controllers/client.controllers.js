const Client = require("../models/client.model");
const ClientLocationReport = require("../models/clientLocationReport.model");

// REGISTRO DE USUARIO (CLIENTE)
const registerClient = async (req, res) => {
  try {
    const { id, nombre, latitude, longitude, start, end } = req.body;

    if (!id || !nombre || !latitude || !longitude || !start || !end) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const existingClient = await Client.findOne({ id });
    if (existingClient) {
      return res.status(400).json({ message: 'Client with this ID already exists' });
    }

    const newClient = new Client({
      id,
      nombre,
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

const getClient = async (req, res) => {
  try {
    const { id } = req.params;

    const client = await Client.findOne({ id });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    res.status(200).json(client);
  } catch (err) {
    console.log("Error obteniendo cliente:", err);
    res.status(500).json({ message: "Error getting client" });
  }
};

const deleteClient = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ message: "Client ID is required" });
    }

    const deletedClient = await Client.findOneAndDelete({ id });

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
  deleteClient,
  createClientLocationReport,
  listClientLocationReports,
  deleteClientLocationReport,
};
const Client = require("../models/client.model");
const ClientLocationReport = require("../models/clientLocationReport.model");

const normalizeClientName = (value) => String(value ?? "").trim();

const normalizeBranchKey = (value) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized || ["principal", "sede principal", "sede", "main", "branch"].includes(normalized)) {
    return "principal";
  }

  return normalized;
};

const buildSavedByPayload = (user) => ({
  id: String(user?.id || user?._id || "").trim(),
  username: String(user?.username || "").trim(),
  email: String(user?.email || "").trim().toLowerCase(),
  role: String(user?.role || "").trim().toLowerCase(),
});

const cleanupDuplicateMainBranches = async (req, res) => {
  try {
    const duplicates = await Client.aggregate([
      {
        $group: {
          _id: "$id",
          total: { $sum: 1 },
          records: { $push: { _id: "$_id", nombre: "$nombre", sucursal: "$sucursal" } },
        },
      },
      {
        $match: {
          total: { $gt: 1 },
        },
      },
    ]);

    let removedCount = 0;

    for (const group of duplicates) {
      const records = group.records || [];
      const seen = new Map();

      for (const record of records) {
        const normalizedName = normalizeClientName(record.nombre).toLowerCase();
        const normalizedBranch = normalizeBranchKey(record.sucursal);
        const dedupeKey = `${normalizedBranch}|${normalizedName}`;

        if (!seen.has(dedupeKey)) {
          seen.set(dedupeKey, record);
          continue;
        }

        await Client.deleteOne({ _id: record._id });
        removedCount += 1;
      }
    }

    if (res) {
      return res.status(200).json({
        message: "Duplicate client branches cleaned up successfully",
        removedCount,
      });
    }

    return { removedCount };
  } catch (err) {
    console.log("Error limpiando clientes duplicados:", err);
    if (res) {
      return res.status(500).json({ message: "Error cleaning duplicate clients" });
    }
    return { removedCount: 0, error: err.message };
  }
};

const registerClient = async (req, res) => {
  try {
    const { id, nombre, latitude, longitude, start, end, sucursal } = req.body;
    const savedBy = buildSavedByPayload(req.user || req.session?.user || null);

    if (!id || !nombre || !latitude || !longitude || !start || !end) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const normalizedId = String(id).trim();
    const normalizedNombre = normalizeClientName(nombre);
    const normalizedSucursal = typeof sucursal === 'string' ? sucursal.trim() : '';
    const existingClients = await Client.find({ id: normalizedId }).lean();

    const duplicateMainBranch = existingClients.find((client) => {
      const currentSucursal = normalizeBranchKey(client?.sucursal);
      const currentName = normalizeClientName(client?.nombre).toLowerCase();
      const incomingBranch = normalizeBranchKey(normalizedSucursal);
      const incomingName = normalizedNombre.toLowerCase();

      return currentSucursal === incomingBranch && currentName === incomingName;
    });

    if (duplicateMainBranch) {
      await Client.deleteOne({ _id: duplicateMainBranch._id });
      return res.status(409).json({
        message: 'Duplicate client branch detected and removed. Please use a different branch name or keep only one main branch.',
      });
    }

    const exactMatch = await Client.findOne({ id: normalizedId, sucursal: normalizedSucursal });
    if (exactMatch) {
      const label = normalizedSucursal ? `(${normalizedSucursal})` : '';
      return res.status(400).json({ message: `Client with this ID ${label} already exists`.trim() });
    }

    const newClient = new Client({
      id: normalizedId,
      nombre: normalizedNombre,
      sucursal: normalizedSucursal,
      location: { latitude, longitude },
      schedule: { start, end },
      savedBy,
    });

    await newClient.save();

    res.status(201).json({
      message: 'Client registered successfully',
      client: buildClientResponse(newClient.toObject ? newClient.toObject() : newClient),
    });
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
    savedBy: {
      id: String(client?.savedBy?.id || "").trim(),
      username: String(client?.savedBy?.username || "").trim(),
      email: String(client?.savedBy?.email || "").trim().toLowerCase(),
      role: String(client?.savedBy?.role || "").trim().toLowerCase(),
    },
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
  cleanupDuplicateMainBranches,
  countClients,
  getClient,
  getClientBranches,
  deleteClient,
  createClientLocationReport,
  listClientLocationReports,
  deleteClientLocationReport,
};

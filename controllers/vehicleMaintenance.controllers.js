const mongoose = require("mongoose");
const VehicleMaintenance = require("../models/vehicleMaintenance.model");

const normalizePlaca = (placa) =>
  typeof placa === "string" ? placa.trim().toUpperCase() : "";

const normalizeOptionalDate = (value) => {
  if (!value) {
    return null;
  }

  const parsedDate = new Date(value);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
};

const normalizeItems = (items) =>
  Array.isArray(items)
    ? items
      .map((item) => ({
        descripcion: typeof item?.descripcion === "string" ? item.descripcion.trim() : "",
        categoria: typeof item?.categoria === "string" ? item.categoria.trim().toLowerCase() : "otro",
        costo: Number(item?.costo) || 0,
      }))
      .filter((item) => item.descripcion)
    : [];

const normalizePayload = (body) => {
  const normalizedItems = normalizeItems(body?.items);
  const calculatedItemsCost = normalizedItems.reduce((total, item) => total + (Number(item.costo) || 0), 0);
  const providedTotal = Number(body?.costoTotal);

  return {
    placa: normalizePlaca(body?.placa),
    modelo: typeof body?.modelo === "string" ? body.modelo.trim() : "",
    anio: Number.isFinite(Number(body?.anio)) ? Number(body.anio) : null,
    tipoServicio: typeof body?.tipoServicio === "string" ? body.tipoServicio.trim().toLowerCase() : "",
    estado: typeof body?.estado === "string" ? body.estado.trim().toLowerCase() : "completado",
    fechaServicio: normalizeOptionalDate(body?.fechaServicio),
    fechaProximoServicio: normalizeOptionalDate(body?.fechaProximoServicio),
    kilometraje: Math.max(Number(body?.kilometraje) || 0, 0),
    taller: typeof body?.taller === "string" ? body.taller.trim() : "",
    tecnicoResponsable: typeof body?.tecnicoResponsable === "string" ? body.tecnicoResponsable.trim() : "",
    titulo: typeof body?.titulo === "string" ? body.titulo.trim() : "",
    descripcion: typeof body?.descripcion === "string" ? body.descripcion.trim() : "",
    moneda: typeof body?.moneda === "string" ? body.moneda.trim().toUpperCase() : "USD",
    costoTotal: Number.isFinite(providedTotal) && providedTotal >= 0 ? providedTotal : calculatedItemsCost,
    items: normalizedItems,
  };
};

const validateMaintenancePayload = (payload) => {
  if (!payload.placa || !payload.titulo || !payload.tipoServicio || !payload.fechaServicio) {
    return "Placa, titulo, tipo de servicio y fecha del servicio son obligatorios";
  }

  if (!["preventivo", "correctivo", "revision", "reparacion"].includes(payload.tipoServicio)) {
    return "El tipo de servicio no es valido";
  }

  if (!["programado", "en_proceso", "completado"].includes(payload.estado)) {
    return "El estado del mantenimiento no es valido";
  }

  if (!payload.moneda || payload.moneda.length > 6) {
    return "La moneda no es valida";
  }

  if (payload.items.some((item) => !["preventivo", "correctivo", "reparacion", "repuesto", "inspeccion", "otro"].includes(item.categoria))) {
    return "Una o mas categorias de items no son validas";
  }

  return "";
};

const listRecentVehicleMaintenance = async (req, res) => {
  try {
    const requestedLimit = Number(req.query.limit);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 100)
      : 30;

    const records = await VehicleMaintenance.find()
      .sort({ fechaServicio: -1, createdAt: -1 })
      .limit(limit);

    return res.status(200).json({
      total: records.length,
      mantenimientos: records,
    });
  } catch (error) {
    console.log("Error obteniendo mantenimientos recientes:", error);
    return res.status(500).json({ message: "Error obteniendo el historial de mantenimiento" });
  }
};

const createVehicleMaintenance = async (req, res) => {
  try {
    const payload = normalizePayload(req.body);
    const validationMessage = validateMaintenancePayload(payload);

    if (validationMessage) {
      return res.status(400).json({ message: validationMessage });
    }

    const newRecord = new VehicleMaintenance(payload);
    await newRecord.save();

    return res.status(201).json({
      message: "Historial de mantenimiento guardado correctamente",
      maintenance: newRecord,
    });
  } catch (error) {
    console.log("Error guardando mantenimiento:", error);
    return res.status(500).json({ message: "Error guardando el mantenimiento del vehiculo" });
  }
};

const getVehicleMaintenanceByPlaca = async (req, res) => {
  try {
    const placa = normalizePlaca(req.params.placa);

    if (!placa) {
      return res.status(400).json({ message: "La placa es obligatoria" });
    }

    const records = await VehicleMaintenance.find({ placa }).sort({ fechaServicio: -1, createdAt: -1 });

    if (!records.length) {
      return res.status(404).json({ message: "No se encontraron mantenimientos para esa placa" });
    }

    return res.status(200).json({
      placa,
      total: records.length,
      mantenimientos: records,
    });
  } catch (error) {
    console.log("Error obteniendo mantenimientos por placa:", error);
    return res.status(500).json({ message: "Error obteniendo el historial por placa" });
  }
};

const getVehicleMaintenanceById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "El id del mantenimiento no es valido" });
    }

    const maintenance = await VehicleMaintenance.findById(id);

    if (!maintenance) {
      return res.status(404).json({ message: "Mantenimiento no encontrado" });
    }

    return res.status(200).json(maintenance);
  } catch (error) {
    console.log("Error obteniendo mantenimiento:", error);
    return res.status(500).json({ message: "Error obteniendo el mantenimiento" });
  }
};

const updateVehicleMaintenance = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "El id del mantenimiento no es valido" });
    }

    const payload = normalizePayload(req.body);
    const validationMessage = validateMaintenancePayload(payload);

    if (validationMessage) {
      return res.status(400).json({ message: validationMessage });
    }

    const maintenance = await VehicleMaintenance.findById(id);

    if (!maintenance) {
      return res.status(404).json({ message: "Mantenimiento no encontrado" });
    }

    Object.assign(maintenance, payload);
    await maintenance.save();

    return res.status(200).json({
      message: "Mantenimiento actualizado correctamente",
      maintenance,
    });
  } catch (error) {
    console.log("Error actualizando mantenimiento:", error);
    return res.status(500).json({ message: "Error actualizando el mantenimiento" });
  }
};

const deleteVehicleMaintenance = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "El id del mantenimiento no es valido" });
    }

    const deletedMaintenance = await VehicleMaintenance.findByIdAndDelete(id);

    if (!deletedMaintenance) {
      return res.status(404).json({ message: "Mantenimiento no encontrado" });
    }

    return res.status(200).json({
      message: "Mantenimiento eliminado correctamente",
      maintenance: deletedMaintenance,
    });
  } catch (error) {
    console.log("Error eliminando mantenimiento:", error);
    return res.status(500).json({ message: "Error eliminando el mantenimiento" });
  }
};

module.exports = {
  listRecentVehicleMaintenance,
  createVehicleMaintenance,
  getVehicleMaintenanceByPlaca,
  getVehicleMaintenanceById,
  updateVehicleMaintenance,
  deleteVehicleMaintenance,
};
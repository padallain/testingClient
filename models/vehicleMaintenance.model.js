const mongoose = require("mongoose");

const maintenanceItemSchema = new mongoose.Schema(
  {
    descripcion: { type: String, required: true, trim: true },
    categoria: {
      type: String,
      enum: ["preventivo", "correctivo", "reparacion", "repuesto", "inspeccion", "otro"],
      default: "otro",
    },
    costo: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const vehicleMaintenanceSchema = new mongoose.Schema(
  {
    placa: { type: String, required: true, trim: true, index: true },
    modelo: { type: String, default: "", trim: true },
    anio: { type: Number, default: null },
    tipoServicio: {
      type: String,
      enum: ["preventivo", "correctivo", "revision", "reparacion"],
      required: true,
    },
    estado: {
      type: String,
      enum: ["programado", "en_proceso", "completado"],
      default: "completado",
    },
    fechaServicio: { type: Date, required: true },
    fechaProximoServicio: { type: Date, default: null },
    kilometraje: { type: Number, default: 0, min: 0 },
    taller: { type: String, default: "", trim: true },
    tecnicoResponsable: { type: String, default: "", trim: true },
    titulo: { type: String, required: true, trim: true },
    descripcion: { type: String, default: "", trim: true },
    moneda: { type: String, default: "USD", trim: true, uppercase: true },
    costoTotal: { type: Number, default: 0, min: 0 },
    items: { type: [maintenanceItemSchema], default: [] },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("VehicleMaintenance", vehicleMaintenanceSchema);
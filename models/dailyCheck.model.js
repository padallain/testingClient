const mongoose = require("mongoose");

const checklistItemSchema = new mongoose.Schema(
  {
    nombre: { type: String, required: true, trim: true },
    estado: { type: String, enum: ["OK", "NO_OK"], required: true },
    comentario: { type: String, default: "", trim: true },
  },
  { _id: false },
);

const dailyCheckSchema = new mongoose.Schema(
  {
    chofer: { type: String, required: true, trim: true },
    placa: { type: String, required: true, trim: true },
    modelo: { type: String, required: true, trim: true },
    anio: { type: Number, required: true },
    fechaHoraRegistro: { type: Date, default: Date.now, immutable: true },
    checklist: {
      type: [checklistItemSchema],
      required: true,
      validate: {
        validator: (items) => Array.isArray(items) && items.length > 0,
        message: "Checklist must contain at least one item",
      },
    },
    fuelLoad: {
      didRefuel: { type: Boolean, default: false },
      fuelType: { type: String, enum: ["", "gasoil", "gasolina"], default: "" },
      liters: { type: Number, min: 0, default: 0 },
      odometerKm: { type: Number, min: 0, default: null },
      totalAmount: { type: Number, min: 0, default: null },
      station: { type: String, default: "", trim: true },
      notes: { type: String, default: "", trim: true },
    },
    observaciones: { type: String, default: "", trim: true },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("DailyCheck", dailyCheckSchema);
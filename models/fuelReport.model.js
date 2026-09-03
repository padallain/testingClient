const mongoose = require("mongoose");

const fuelReportSchema = new mongoose.Schema(
  {
    chofer: { type: String, required: true, trim: true, index: true },
    placa: { type: String, required: true, trim: true, uppercase: true, index: true },
    fuelType: {
      type: String,
      enum: ["gasoil", "gasolina"],
      required: true,
      trim: true,
      index: true,
    },
    liters: { type: Number, required: true, min: 0.01 },
    odometerKm: { type: Number, required: true, min: 0 },
    totalAmount: { type: Number, default: null, min: 0 },
    station: { type: String, default: "", trim: true },
    notes: { type: String, default: "", trim: true },
    reportedAt: { type: Date, default: Date.now, index: true },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("FuelReport", fuelReportSchema);

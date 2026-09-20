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
    receiptNumber: { type: String, default: "", trim: true, uppercase: true, index: true },
    pricePerLiter: { type: Number, default: null, min: 0 },
    securityFlags: { type: [String], default: [] },
    securityScore: { type: Number, default: 0, min: 0 },
    reportedBy: {
      id: { type: String, default: "", trim: true },
      username: { type: String, default: "", trim: true },
      role: { type: String, default: "", trim: true, lowercase: true },
      email: { type: String, default: "", trim: true, lowercase: true },
    },
    source: {
      ip: { type: String, default: "", trim: true },
      userAgent: { type: String, default: "", trim: true },
    },
    receiptPhoto: {
      dataUrl: { type: String, default: "" },
      mimeType: { type: String, default: "", trim: true },
      sizeKb: { type: Number, default: 0, min: 0 },
      capturedAt: { type: Date, default: Date.now },
    },
    photoRetention: {
      expiresAt: { type: Date, default: Date.now },
      status: {
        type: String,
        enum: ["active", "pending_deletion", "deleted"],
        default: "active",
        index: true,
      },
      deletionRequestedAt: { type: Date, default: null },
      deletedAt: { type: Date, default: null },
    },
    notes: { type: String, default: "", trim: true },
    reportedAt: { type: Date, default: Date.now, index: true },
  },
  {
    timestamps: true,
  },
);

fuelReportSchema.index({ placa: 1, reportedAt: -1 });
fuelReportSchema.index({ chofer: 1, reportedAt: -1 });

module.exports = mongoose.model("FuelReport", fuelReportSchema);

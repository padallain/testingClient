const mongoose = require('mongoose');

const clientLocationReportSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, trim: true, index: true },
    reporterName: { type: String, default: '', trim: true },
    reporterId: { type: String, default: '', trim: true, index: true },
    targetClientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null },
    sucursal: { type: String, default: '', trim: true },
    proposedSucursal: { type: String, trim: true, maxlength: 120 },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    proposedLocation: {
      latitude: { type: Number, min: -90, max: 90 },
      longitude: { type: Number, min: -180, max: 180 },
    },
    accuracyMeters: { type: Number, min: 0, default: null },
    reviewedBy: {
      id: { type: String },
      name: { type: String },
    },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, default: '', trim: true },
    details: { type: String, required: true, trim: true },
    clientFound: { type: Boolean, default: false },
    clientSnapshot: {
      id: { type: String },
      nombre: { type: String },
      sucursal: { type: String },
      location: {
        latitude: { type: Number },
        longitude: { type: Number },
      },
      schedule: {
        start: { type: String },
        end: { type: String },
      },
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model('ClientLocationReport', clientLocationReportSchema);
const mongoose = require('mongoose');

const clientLocationReportSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, trim: true, index: true },
    reporterName: { type: String, default: '', trim: true },
    details: { type: String, required: true, trim: true },
    clientFound: { type: Boolean, default: false },
    clientSnapshot: {
      id: { type: String },
      nombre: { type: String },
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
const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema({
  id: { type: String, required: true, trim: true },
  nombre: { type: String, required: true, trim: true },
  // Identifies the branch for chain clients (e.g. "Sede Norte", "Local 2").
  // Empty string means single-location client (non-chain).
  sucursal: { type: String, default: '', trim: true },
  location: {
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
  },
  schedule: {
    start: { type: String, required: true },
    end: { type: String, required: true },
  },
});

// Compound unique: same chain ID can exist with different sucursal values.
// Single-location clients use sucursal: "" and remain unique by id alone.
clientSchema.index({ id: 1, sucursal: 1 }, { unique: true });

module.exports = mongoose.model('Client', clientSchema);

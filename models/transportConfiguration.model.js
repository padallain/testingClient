const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'default' },
  version: { type: Number, default: 1 },
  settings: { type: mongoose.Schema.Types.Mixed, required: true },
  vehicleTypes: { type: [mongoose.Schema.Types.Mixed], default: [] },
  carriers: { type: [mongoose.Schema.Types.Mixed], default: [] },
  vehicles: { type: [mongoose.Schema.Types.Mixed], default: [] },
}, { timestamps: true });

module.exports = mongoose.model('TransportConfiguration', schema);
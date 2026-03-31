const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  nombre: { type: String, required: true },
  location: {
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
  },
  schedule: {
    start: { type: String, required: true },
    end: { type: String, required: true },
  },
});

module.exports = mongoose.model('Client', clientSchema);
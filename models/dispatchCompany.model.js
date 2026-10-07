const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 140 },
  normalizedName: { type: String, required: true, unique: true },
}, { timestamps: true });

module.exports = mongoose.model('DispatchCompany', schema);
const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  _id: { type: String, default: 'default' },
  defaultCompanyId: { type: mongoose.Schema.Types.ObjectId, ref: 'DispatchCompany', default: null },
}, { timestamps: true });

module.exports = mongoose.model('DispatchCompanySettings', schema);
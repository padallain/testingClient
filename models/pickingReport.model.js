const mongoose = require('mongoose');

const pickingReportSchema = new mongoose.Schema(
  {
    responsableId: { type: String, required: true, trim: true, index: true },
    numeroPedido: { type: String, required: true, trim: true, index: true },
    numeroCajas: { type: Number, required: true, min: 1 },
    fechaHoraRegistro: { type: Date, default: Date.now, index: true },
  },
  {
    timestamps: true,
  },
);

pickingReportSchema.index({ responsableId: 1, fechaHoraRegistro: -1 });

module.exports = mongoose.model('PickingReport', pickingReportSchema);
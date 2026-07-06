const mongoose = require('mongoose');

const pickingErrorReportSchema = new mongoose.Schema(
  {
    pickingReportId: { type: mongoose.Schema.Types.ObjectId, ref: 'PickingReport', required: true, index: true },
    numeroPedido: { type: String, required: true, trim: true, index: true },
    responsableId: { type: String, required: true, trim: true, index: true },
    numeroCajas: { type: Number, default: 0, min: 0 },
    tipoError: { type: String, required: true, trim: true },
    descripcion: { type: String, required: true, trim: true },
  },
  {
    timestamps: true,
  },
);

pickingErrorReportSchema.index({ responsableId: 1, createdAt: -1 });

module.exports = mongoose.model('PickingErrorReport', pickingErrorReportSchema);
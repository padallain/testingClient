const mongoose = require('mongoose');

const dispatchIssueItemSchema = new mongoose.Schema(
  {
    productId: { type: String, required: true, trim: true, index: true },
    novelty: { type: String, required: true, trim: true },
    presentationType: {
      type: String,
      enum: ['caja', 'unidad'],
      required: true,
      default: 'unidad',
    },
    quantity: { type: Number, required: true, min: 1, default: 1 },
  },
  { _id: false },
);

const dispatchIssueReportSchema = new mongoose.Schema(
  {
    routeId: { type: mongoose.Schema.Types.ObjectId, ref: 'RouteAssignment', required: true, index: true },
    routeLabel: { type: String, default: '', trim: true },
    driverId: { type: String, required: true, trim: true, index: true },
    driverName: { type: String, default: '', trim: true },
    clientId: { type: String, required: true, trim: true, index: true },
    clientName: { type: String, required: true, trim: true },
    stopOrder: { type: Number, required: true, min: 1 },
    orderNumber: { type: String, required: true, trim: true, index: true },
    items: { type: [dispatchIssueItemSchema], required: true, default: [] },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model('DispatchIssueReport', dispatchIssueReportSchema);
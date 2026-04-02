const mongoose = require('mongoose');

const routeStopSchema = new mongoose.Schema(
  {
    order: { type: Number, required: true },
    clientId: { type: String, required: true, trim: true },
    nombre: { type: String, required: true, trim: true },
    weight: { type: Number, default: 0, min: 0 },
    location: {
      latitude: { type: Number, required: true },
      longitude: { type: Number, required: true },
    },
    googleMapsLink: { type: String, required: true },
    dispatched: { type: Boolean, default: false },
    dispatchedAt: { type: Date, default: null },
  },
  { _id: false },
);

const missingClientSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, trim: true },
    weight: { type: Number, default: 0, min: 0 },
    resolved: { type: Boolean, default: false },
    resolvedAt: { type: Date, default: null },
  },
  { _id: false },
);

const routeAssignmentSchema = new mongoose.Schema(
  {
    driverId: { type: String, required: true, trim: true, index: true },
    driverName: { type: String, default: '', trim: true },
    routeLabel: { type: String, required: true, trim: true },
    uniqueClientCount: { type: Number, required: true, min: 0 },
    totalWeight: { type: Number, required: true, min: 0 },
    duplicateClientIds: { type: [String], default: [] },
    googleMapsRouteLinks: { type: [String], default: [] },
    openRouteLink: { type: String, default: '' },
    status: {
      type: String,
      enum: ['active', 'completed'],
      default: 'active',
      index: true,
    },
    stops: { type: [routeStopSchema], default: [] },
    missingClients: { type: [missingClientSchema], default: [] },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model('RouteAssignment', routeAssignmentSchema);
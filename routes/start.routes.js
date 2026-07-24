const express = require('express');
const { register, login, getSession, logout, requestPasswordResetCode, verifyPasswordResetCode, resetPasswordWithCode, authMiddleware } = require('../controllers/auth.controllers');
const { makeRoute, getDriverCurrentRoute, listRouteAssignments, listRouteDispatchStatuses, getDriverPerformanceAnalytics, updateRouteAssignment, deleteRouteAssignment, updateStopDispatchStatus, customizeDriverRoute, resetDriverRoute, updateMissingClientResolution, createDispatchIssueReport, updateDispatchIssueReport, deleteDispatchIssueReport, listDispatchIssueReports, getRouteDispatchIssueSummary } = require('../controllers/routing.controllers');
const { registerClient, countClients, getClient, getClientBranches, deleteClient, createClientLocationReport, listClientLocationReports, deleteClientLocationReport } = require('../controllers/client.controllers');
const { createDailyCheck, getDailyCheckById, getDailyChecksByPlaca, getRecentDailyChecks, updateDailyCheck, deleteDailyCheck } = require('../controllers/dailyCheck.controllers');
const { createVehicleMaintenance, listRecentVehicleMaintenance, listUpcomingVehicleMaintenance, getVehicleMaintenanceById, getVehicleMaintenanceByPlaca, updateVehicleMaintenance, deleteVehicleMaintenance } = require('../controllers/vehicleMaintenance.controllers');
const { getDispatchPage, getDispatchConfig, calculateDispatch } = require('../controllers/dispatch.controllers');
const { getDespachoPage } = require('../controllers/despacho.controllers');
const { createPickingReport, listRecentPickingReports, getPickingSummary, getPickingReportById, getPickingReportByOrderNumber, createPickingErrorReport } = require('../controllers/picking.controllers');
const despachoRoutes = require('./despacho.routes');
const router = express.Router();

router.use(express.json());

const requireAdminDeleteKey = (req, res, next) => {
  const configuredKey = process.env.ADMIN_DELETE_KEY || '4321';
  const providedKey = req.headers['x-admin-delete-key'];

  if (!configuredKey) {
    return res.status(500).json({ message: 'ADMIN_DELETE_KEY is not configured' });
  }

  if (!providedKey || providedKey !== configuredKey) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  next();
};

// Auth routes
router.get('/', (req, res) => {
  res.send('You have to log in.');
});

// Auth routes
router.post('/register', register);
router.post('/login', login);
router.get('/session', getSession);
router.post('/logout', logout);
router.post('/recover-password/request-code', requestPasswordResetCode);
router.post('/recover-password/verify-code', verifyPasswordResetCode);
router.post('/recover-password/reset', resetPasswordWithCode);

router.use(authMiddleware);

// Rutas de clientes
router.post('/registerClient', registerClient);
router.get('/countClients', countClients);
router.get('/getClient/:id', getClient);
router.get('/getClient/:id/sedes', getClientBranches);
router.post('/clientLocationReports', createClientLocationReport);
router.get('/clientLocationReports', listClientLocationReports);
router.get('/internal/admin/clientLocationReports', requireAdminDeleteKey, listClientLocationReports);
router.delete('/internal/admin/clientLocationReports/:reportId', requireAdminDeleteKey, deleteClientLocationReport);
router.delete('/internal/admin/deleteClient/:id', requireAdminDeleteKey, deleteClient);

// Rutas de logística
router.post('/makeRoute', makeRoute);
router.get('/driver-routes/:driverId/current', getDriverCurrentRoute);
router.get('/driver-routes/:routeId/issues-summary', getRouteDispatchIssueSummary);
router.patch('/driver-routes/:routeId/customize', customizeDriverRoute);
router.post('/driver-routes/:routeId/reset', resetDriverRoute);
router.get('/route-dispatch-status', listRouteDispatchStatuses);
router.get('/driver-performance-analytics', getDriverPerformanceAnalytics);
router.get('/internal/admin/routes', requireAdminDeleteKey, listRouteAssignments);
router.patch('/internal/admin/routes/:routeId', requireAdminDeleteKey, updateRouteAssignment);
router.delete('/internal/admin/routes/:routeId', requireAdminDeleteKey, deleteRouteAssignment);
router.patch('/driver-routes/:routeId/stops/:clientId/dispatch', updateStopDispatchStatus);
router.patch('/driver-routes/:routeId/missing/:clientId/resolve', updateMissingClientResolution);
router.post('/driver-routes/:routeId/stops/:clientId/issues', createDispatchIssueReport);
router.get('/internal/admin/dispatchIssueReports', requireAdminDeleteKey, listDispatchIssueReports);
router.patch('/internal/admin/dispatchIssueReports/:reportId', requireAdminDeleteKey, updateDispatchIssueReport);
router.delete('/internal/admin/dispatchIssueReports/:reportId', requireAdminDeleteKey, deleteDispatchIssueReport);
router.post('/dailyCheck', createDailyCheck);
router.get('/dailyCheck', getRecentDailyChecks);
router.get('/dailyCheck/placa/:placa', getDailyChecksByPlaca);
router.get('/dailyCheck/:id', getDailyCheckById);
router.patch('/internal/admin/dailyCheck/:id', requireAdminDeleteKey, updateDailyCheck);
router.delete('/internal/admin/dailyCheck/:id', requireAdminDeleteKey, deleteDailyCheck);
router.post('/vehicle-maintenance', requireAdminDeleteKey, createVehicleMaintenance);
router.get('/vehicle-maintenance', listRecentVehicleMaintenance);
router.get('/vehicle-maintenance/upcoming', listUpcomingVehicleMaintenance);
router.get('/vehicle-maintenance/placa/:placa', getVehicleMaintenanceByPlaca);
router.get('/vehicle-maintenance/:id', getVehicleMaintenanceById);
router.patch('/internal/admin/vehicle-maintenance/:id', requireAdminDeleteKey, updateVehicleMaintenance);
router.delete('/internal/admin/vehicle-maintenance/:id', requireAdminDeleteKey, deleteVehicleMaintenance);

// Picking operativo
router.get('/picking', (req, res) => {
  res.sendFile(require('path').join(__dirname, '../public/picking.html'));
});
router.post('/picking-reports', createPickingReport);
router.get('/picking-reports/:id', getPickingReportById);
router.get('/internal/admin/picking-reports', requireAdminDeleteKey, listRecentPickingReports);
router.get('/internal/admin/picking-reports/order/:numeroPedido', requireAdminDeleteKey, getPickingReportByOrderNumber);
router.post('/internal/admin/picking-reports/order/:numeroPedido/errors', requireAdminDeleteKey, createPickingErrorReport);
router.get('/internal/admin/picking-reports/summary', requireAdminDeleteKey, getPickingSummary);

// Despacho logístico
router.get('/dispatch', getDispatchPage);
router.get('/dispatch/config', getDispatchConfig);
router.post('/dispatch/calculate', calculateDispatch);
router.get('/despacho', getDespachoPage);
router.use('/api/despacho', despachoRoutes);

module.exports = router;
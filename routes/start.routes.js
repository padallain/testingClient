const express = require('express');
const { register, login, getSession, logout, requestPasswordResetCode, verifyPasswordResetCode, resetPasswordWithCode, listUsersForAdmin, listReporterUsersForAdmin, approveUserByAdmin, updateUserRoleByAdmin, updateUserPasswordByAdmin, authMiddleware, requireAdminRole } = require('../controllers/auth.controllers');
const { makeRoute, getDriverCurrentRoute, getDriverRouteById, listRouteAssignments, listRouteDispatchStatuses, getRouteDispatchStatusDetail, getDriverPerformanceAnalytics, updateRouteAssignment, deleteRouteAssignment, updateStopDispatchStatus, addStopToDriverRoute, removeStopFromDriverRoute, reoptimizeDriverRoute, previewDriverRouteCustomization, customizeDriverRoute, resetDriverRoute, updateMissingClientResolution, createDispatchIssueReport, updateDispatchIssueReport, deleteDispatchIssueReport, listDispatchIssueReports, getRouteDispatchIssueSummary, exportRouteAsGpx } = require('../controllers/routing.controllers');
const { registerClient, countClients, getClient, getClientBranches, deleteClient, createClientLocationReport, listClientLocationReports, deleteClientLocationReport } = require('../controllers/client.controllers');
const { createDailyCheck, getDailyCheckById, getDailyChecksByPlaca, getRecentDailyChecks, getDailyFuelConsumption, updateDailyCheck, deleteDailyCheck } = require('../controllers/dailyCheck.controllers');
const { createFuelReport, getDailyFuelConsumptionFromReports } = require('../controllers/fuelReport.controllers');
const { createVehicleMaintenance, listRecentVehicleMaintenance, listUpcomingVehicleMaintenance, getVehicleMaintenanceById, getVehicleMaintenanceByPlaca, updateVehicleMaintenance, deleteVehicleMaintenance } = require('../controllers/vehicleMaintenance.controllers');
const { getDispatchPage, getDispatchConfig, calculateDispatch } = require('../controllers/dispatch.controllers');
const { getDespachoPage } = require('../controllers/despacho.controllers');
const { createPickingReport, listRecentPickingReports, getPickingSummary, getPickingReportById, getPickingReportByOrderNumber, createPickingErrorReport, updatePickingReport, deletePickingReport } = require('../controllers/picking.controllers');
const {
  sendTestEmailByAdmin,
  sendReminderEmailByAdmin,
  sendTestWhatsAppByAdmin,
  sendReminderWhatsAppByAdmin,
} = require('../controllers/notifications.controllers');
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

// Administración de usuarios
router.get('/internal/admin/users', requireAdminRole, listUsersForAdmin);
router.get('/internal/admin/users/reporters', requireAdminRole, listReporterUsersForAdmin);
router.patch('/internal/admin/users/:userId/approval', requireAdminRole, approveUserByAdmin);
router.patch('/internal/admin/users/:userId/role', requireAdminRole, updateUserRoleByAdmin);
router.patch('/internal/admin/users/:userId/password', requireAdminRole, updateUserPasswordByAdmin);
router.post('/internal/admin/users', requireAdminRole, register);
router.post('/internal/admin/notifications/email-test', requireAdminRole, sendTestEmailByAdmin);
router.post('/internal/admin/notifications/reminder-email', requireAdminRole, sendReminderEmailByAdmin);
router.post('/internal/admin/notifications/whatsapp-test', requireAdminRole, sendTestWhatsAppByAdmin);
router.post('/internal/admin/notifications/reminder-whatsapp', requireAdminRole, sendReminderWhatsAppByAdmin);

// Rutas de clientes
router.post('/registerClient', registerClient);
router.get('/countClients', countClients);
router.get('/getClient/:id', getClient);
router.get('/getClient/:id/sedes', getClientBranches);
router.post('/clientLocationReports', createClientLocationReport);
router.get('/clientLocationReports', listClientLocationReports);
router.get('/internal/admin/clientLocationReports', requireAdminRole, requireAdminDeleteKey, listClientLocationReports);
router.delete('/internal/admin/clientLocationReports/:reportId', requireAdminRole, requireAdminDeleteKey, deleteClientLocationReport);
router.delete('/internal/admin/deleteClient/:id', requireAdminRole, requireAdminDeleteKey, deleteClient);

// Rutas de logística
router.post('/makeRoute', makeRoute);
router.get('/driver-routes/:driverId/current', getDriverCurrentRoute);
router.get('/driver-routes/by-id/:routeId', getDriverRouteById);
router.get('/driver-routes/:routeId/export-gpx', exportRouteAsGpx);
router.get('/driver-routes/:routeId/issues-summary', getRouteDispatchIssueSummary);
router.post('/driver-routes/:routeId/customize/preview', previewDriverRouteCustomization);
router.patch('/driver-routes/:routeId/customize', customizeDriverRoute);
router.post('/driver-routes/:routeId/reset', resetDriverRoute);
router.get('/route-dispatch-status', listRouteDispatchStatuses);
router.get('/route-dispatch-status/:routeId', getRouteDispatchStatusDetail);
router.get('/driver-performance-analytics', getDriverPerformanceAnalytics);
router.get('/internal/admin/routes', requireAdminRole, requireAdminDeleteKey, listRouteAssignments);
router.patch('/internal/admin/routes/:routeId', requireAdminRole, requireAdminDeleteKey, updateRouteAssignment);
router.delete('/internal/admin/routes/:routeId', requireAdminRole, requireAdminDeleteKey, deleteRouteAssignment);
router.patch('/driver-routes/:routeId/stops/:clientId/dispatch', updateStopDispatchStatus);
router.post('/driver-routes/:routeId/stops', addStopToDriverRoute);
router.delete('/driver-routes/:routeId/stops/:clientId', removeStopFromDriverRoute);
router.post('/driver-routes/:routeId/reoptimize', reoptimizeDriverRoute);
router.patch('/driver-routes/:routeId/missing/:clientId/resolve', updateMissingClientResolution);
router.post('/driver-routes/:routeId/stops/:clientId/issues', createDispatchIssueReport);
router.post('/internal/admin/driver-routes/:routeId/stops/:clientId/issues', requireAdminRole, requireAdminDeleteKey, createDispatchIssueReport);
router.get('/internal/admin/dispatchIssueReports', requireAdminRole, requireAdminDeleteKey, listDispatchIssueReports);
router.patch('/internal/admin/dispatchIssueReports/:reportId', requireAdminRole, requireAdminDeleteKey, updateDispatchIssueReport);
router.delete('/internal/admin/dispatchIssueReports/:reportId', requireAdminRole, requireAdminDeleteKey, deleteDispatchIssueReport);
router.post('/dailyCheck', createDailyCheck);
router.get('/dailyCheck', getRecentDailyChecks);
router.get('/fuel-consumption/daily', getDailyFuelConsumption);
router.post('/fuel-reports', createFuelReport);
router.get('/fuel-reports/daily-summary', getDailyFuelConsumptionFromReports);
router.get('/dailyCheck/placa/:placa', getDailyChecksByPlaca);
router.get('/dailyCheck/:id', getDailyCheckById);
router.patch('/internal/admin/dailyCheck/:id', requireAdminRole, requireAdminDeleteKey, updateDailyCheck);
router.delete('/internal/admin/dailyCheck/:id', requireAdminRole, requireAdminDeleteKey, deleteDailyCheck);
router.post('/vehicle-maintenance', requireAdminRole, requireAdminDeleteKey, createVehicleMaintenance);
router.get('/vehicle-maintenance', listRecentVehicleMaintenance);
router.get('/vehicle-maintenance/upcoming', listUpcomingVehicleMaintenance);
router.get('/vehicle-maintenance/placa/:placa', getVehicleMaintenanceByPlaca);
router.get('/vehicle-maintenance/:id', getVehicleMaintenanceById);
router.patch('/internal/admin/vehicle-maintenance/:id', requireAdminRole, requireAdminDeleteKey, updateVehicleMaintenance);
router.delete('/internal/admin/vehicle-maintenance/:id', requireAdminRole, requireAdminDeleteKey, deleteVehicleMaintenance);

// Picking operativo
router.get('/picking', (req, res) => {
  res.sendFile(require('path').join(__dirname, '../public/picking.html'));
});
router.post('/picking-reports', createPickingReport);
router.get('/picking-reports/:id', getPickingReportById);
router.get('/internal/admin/picking-reports', requireAdminRole, requireAdminDeleteKey, listRecentPickingReports);
router.patch('/internal/admin/picking-reports/:id', requireAdminRole, requireAdminDeleteKey, updatePickingReport);
router.delete('/internal/admin/picking-reports/:id', requireAdminRole, requireAdminDeleteKey, deletePickingReport);
router.get('/internal/admin/picking-reports/order/:numeroPedido', requireAdminRole, requireAdminDeleteKey, getPickingReportByOrderNumber);
router.post('/internal/admin/picking-reports/order/:numeroPedido/errors', requireAdminRole, requireAdminDeleteKey, createPickingErrorReport);
router.get('/internal/admin/picking-reports/summary', requireAdminRole, requireAdminDeleteKey, getPickingSummary);

// Despacho logístico
router.get('/dispatch', getDispatchPage);
router.get('/dispatch/config', getDispatchConfig);
router.post('/dispatch/calculate', calculateDispatch);
router.get('/despacho', getDespachoPage);
router.use('/api/despacho', despachoRoutes);

module.exports = router;
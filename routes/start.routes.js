const express = require('express');
const { register, login, authMiddleware } = require('../controllers/auth.controllers');
const { makeRoute, getDriverCurrentRoute, updateStopDispatchStatus, updateMissingClientResolution, createDispatchIssueReport, updateDispatchIssueReport, deleteDispatchIssueReport, listDispatchIssueReports, getRouteDispatchIssueSummary } = require('../controllers/routing.controllers');
const { registerClient, countClients, getClient, deleteClient, createClientLocationReport, listClientLocationReports, deleteClientLocationReport } = require('../controllers/client.controllers');
const { createDailyCheck, getDailyCheckById, getDailyChecksByPlaca, getRecentDailyChecks } = require('../controllers/dailyCheck.controllers');
const router = express.Router();

router.use(express.json());

const requireAdminDeleteKey = (req, res, next) => {
  const configuredKey = process.env.ADMIN_DELETE_KEY;
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

// Rutas de clientes
router.post('/registerClient', registerClient);
router.get('/countClients', countClients);
router.get('/getClient/:id', getClient);
router.post('/clientLocationReports', createClientLocationReport);
router.get('/clientLocationReports', listClientLocationReports);
router.get('/internal/admin/clientLocationReports', requireAdminDeleteKey, listClientLocationReports);
router.delete('/internal/admin/clientLocationReports/:reportId', requireAdminDeleteKey, deleteClientLocationReport);
router.delete('/internal/admin/deleteClient/:id', requireAdminDeleteKey, deleteClient);

// Rutas de logística
router.post('/makeRoute', makeRoute);
router.get('/driver-routes/:driverId/current', getDriverCurrentRoute);
router.get('/driver-routes/:routeId/issues-summary', getRouteDispatchIssueSummary);
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

module.exports = router;
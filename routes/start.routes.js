const express = require('express');
const { register, login, authMiddleware } = require('../controllers/auth.controllers');
const { makeRoute } = require('../controllers/routing.controllers'); // Asegúrate de tener la función makeRoute en tu controlador
const { registerClient, countClients, getClient, deleteClient, createClientLocationReport } = require('../controllers/client.controllers');
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
router.delete('/internal/admin/deleteClient/:id', requireAdminDeleteKey, deleteClient);

// Rutas de logística
router.post('/makeRoute', makeRoute);
router.post('/dailyCheck', createDailyCheck);
router.get('/dailyCheck', getRecentDailyChecks);
router.get('/dailyCheck/placa/:placa', getDailyChecksByPlaca);
router.get('/dailyCheck/:id', getDailyCheckById);

module.exports = router;
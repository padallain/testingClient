const express = require('express');
const { register, login, authMiddleware } = require('../controllers/auth.controllers');
const { makeRoute } = require('../controllers/routing.controllers'); // Asegúrate de tener la función makeRoute en tu controlador
const { registerClient, countClients, getClient } = require('../controllers/client.controllers');
const router = express.Router();

router.use(express.json());

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

// Rutas de logística
router.post('/makeRoute', makeRoute);

module.exports = router;
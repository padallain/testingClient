const express = require('express');
const { register, getClient } = require('../controllers/auth.controllers');
const { makeRoute } = require('../controllers/routing.controllers'); // Asegúrate de tener la función makeRoute en tu controlador
const router = express.Router();

router.use(express.json());

// Auth routes
router.get('/', (req, res) => {
  res.send('You have to log in.');
});
router.post('/saveClient', register);
router.post('/makeRoute', makeRoute);

// Nueva ruta para obtener un cliente por ID
router.get('/getClient/:id', getClient);

module.exports = router;
const express = require('express');
const { register, getClient } = require('../controllers/auth.controllers');
const router = express.Router();

router.use(express.json());

// Auth routes
router.get('/', (req, res) => {
  res.send('You have to log in.');
});
router.post('/saveClient', register);

// Nueva ruta para obtener un cliente por ID
router.get('/getClient/:id', getClient);

module.exports = router;
const express = require('express');
const { calculateDespacho, getUltimoDespacho, getHistorialDespachos } = require('../controllers/despacho.controllers');

const router = express.Router();

router.post('/calcular', calculateDespacho);
router.get('/ultimo', getUltimoDespacho);
router.get('/historial', getHistorialDespachos);

module.exports = router;
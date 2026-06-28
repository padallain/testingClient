const path = require('path');
const Despacho = require('../models/Despacho');
const { calculateOptimalDispatch, normalizeZones } = require('../services/optimizador');

exports.getDespachoPage = (req, res) => {
  res.sendFile(path.join(__dirname, '../public/despacho.html'));
};

exports.calculateDespacho = async (req, res) => {
  try {
    const zonas = Array.isArray(req.body?.zonas) ? req.body.zonas : [];
    const costoExternoReferencia = Number(req.body?.costo_externo_referencia) || 0;
    const vehiculos = req.body?.vehiculos;
    const zonasNormalizadas = normalizeZones(zonas);

    if (!zonasNormalizadas.length) {
      return res.status(400).json({ error: 'Debes enviar al menos una zona válida.' });
    }

    const result = calculateOptimalDispatch({
      zonas: zonasNormalizadas,
      costoExternoReferencia,
      vehiculos,
    });

    const saved = await Despacho.create(result);

    res.json({
      ...result,
      id: saved._id,
    });
  } catch (error) {
    console.error('Error en calculateDespacho:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'No se pudo calcular el despacho óptimo.' });
  }
};

exports.getUltimoDespacho = async (req, res) => {
  try {
    const ultimo = await Despacho.findOne().sort({ fecha: -1, createdAt: -1 }).lean();

    if (!ultimo) {
      return res.status(404).json({ error: 'No hay planes de despacho guardados.' });
    }

    res.json(ultimo);
  } catch (error) {
    console.error('Error en getUltimoDespacho:', error);
    res.status(500).json({ error: 'No se pudo consultar el último despacho.' });
  }
};

exports.getHistorialDespachos = async (req, res) => {
  try {
    const limite = Math.min(Math.max(Number(req.query?.limite) || 30, 1), 100);
    const historial = await Despacho.find()
      .sort({ fecha: -1, createdAt: -1 })
      .limit(limite)
      .select('fecha resumen plan zonas_externo zonas_mañana recomendaciones estrategia')
      .lean();

    res.json(historial);
  } catch (error) {
    console.error('Error en getHistorialDespachos:', error);
    res.status(500).json({ error: 'No se pudo consultar el historial de despachos.' });
  }
};
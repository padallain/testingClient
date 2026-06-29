const mongoose = require('mongoose');
const PickingReport = require('../models/pickingReport.model');

function normalizeResponsibleId(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function normalizeOrderNumber(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function parsePositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function parseDateRange(query = {}) {
  const singleDate = query.fecha ? new Date(query.fecha) : null;

  if (singleDate && !Number.isNaN(singleDate.getTime())) {
    const start = new Date(singleDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(singleDate);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  const from = query.desde ? new Date(query.desde) : new Date();
  const to = query.hasta ? new Date(query.hasta) : new Date(from);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return null;
  }

  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);

  if (from > to) {
    return null;
  }

  return { start: from, end: to };
}

async function createPickingReport(req, res) {
  try {
    const responsableId = normalizeResponsibleId(req.body?.responsableId);
    const numeroPedido = normalizeOrderNumber(req.body?.numeroPedido);
    const numeroCajas = parsePositiveInteger(req.body?.numeroCajas);

    if (!responsableId || !numeroPedido || !numeroCajas) {
      return res.status(400).json({
        message: 'responsableId, numeroPedido y numeroCajas son obligatorios.',
      });
    }

    const existing = await PickingReport.findOne({ numeroPedido });
    if (existing) {
      return res.status(409).json({
        message: 'Ese numero de pedido ya fue registrado en picking.',
      });
    }

    const pickingReport = await PickingReport.create({
      responsableId,
      numeroPedido,
      numeroCajas,
    });

    return res.status(201).json({
      message: 'Picking guardado correctamente.',
      pickingReport,
    });
  } catch (error) {
    console.error('Error guardando picking:', error);
    return res.status(500).json({
      message: 'Error guardando el picking.',
    });
  }
}

async function listRecentPickingReports(req, res) {
  try {
    const limitValue = Number(req.query?.limit);
    const limit = Number.isFinite(limitValue) && limitValue > 0 ? Math.min(limitValue, 100) : 20;
    const reports = await PickingReport.find().sort({ fechaHoraRegistro: -1 }).limit(limit).lean();

    return res.status(200).json({
      total: reports.length,
      reportes: reports,
    });
  } catch (error) {
    console.error('Error consultando picking reciente:', error);
    return res.status(500).json({
      message: 'Error consultando pickings recientes.',
    });
  }
}

async function getPickingSummary(req, res) {
  try {
    const range = parseDateRange(req.query);

    if (!range) {
      return res.status(400).json({
        message: 'Debes enviar una fecha valida o un rango valido con desde y hasta.',
      });
    }

    const matchStage = {
      fechaHoraRegistro: {
        $gte: range.start,
        $lte: range.end,
      },
    };

    const [totals, ranking, topWorker, details] = await Promise.all([
      PickingReport.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: null,
            totalPedidos: { $sum: 1 },
            totalCajas: { $sum: '$numeroCajas' },
            responsablesActivos: { $addToSet: '$responsableId' },
          },
        },
      ]),
      PickingReport.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: '$responsableId',
            totalPedidos: { $sum: 1 },
            totalCajas: { $sum: '$numeroCajas' },
          },
        },
        { $sort: { totalPedidos: -1, totalCajas: -1, _id: 1 } },
      ]),
      PickingReport.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: '$responsableId',
            totalPedidos: { $sum: 1 },
            totalCajas: { $sum: '$numeroCajas' },
          },
        },
        { $sort: { totalPedidos: -1, totalCajas: -1, _id: 1 } },
        { $limit: 1 },
      ]),
      PickingReport.find(matchStage).sort({ fechaHoraRegistro: -1 }).lean(),
    ]);

    const totalsRow = totals[0] || { totalPedidos: 0, totalCajas: 0, responsablesActivos: [] };

    return res.status(200).json({
      filtro: {
        desde: range.start,
        hasta: range.end,
      },
      resumen: {
        totalPedidos: totalsRow.totalPedidos || 0,
        totalCajas: totalsRow.totalCajas || 0,
        responsablesActivos: Array.isArray(totalsRow.responsablesActivos) ? totalsRow.responsablesActivos.length : 0,
        responsableConMasPicking: topWorker[0]
          ? {
              responsableId: topWorker[0]._id,
              totalPedidos: topWorker[0].totalPedidos,
              totalCajas: topWorker[0].totalCajas,
            }
          : null,
      },
      ranking: ranking.map((item) => ({
        responsableId: item._id,
        totalPedidos: item.totalPedidos,
        totalCajas: item.totalCajas,
      })),
      reportes: details,
    });
  } catch (error) {
    console.error('Error consultando resumen picking:', error);
    return res.status(500).json({
      message: 'Error consultando el resumen de picking.',
    });
  }
}

async function getPickingReportById(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'El id del picking no es valido.' });
    }

    const report = await PickingReport.findById(id).lean();

    if (!report) {
      return res.status(404).json({ message: 'Picking no encontrado.' });
    }

    return res.status(200).json(report);
  } catch (error) {
    console.error('Error consultando picking por id:', error);
    return res.status(500).json({ message: 'Error consultando el picking.' });
  }
}

module.exports = {
  createPickingReport,
  listRecentPickingReports,
  getPickingSummary,
  getPickingReportById,
};
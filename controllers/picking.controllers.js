const mongoose = require('mongoose');
const PickingReport = require('../models/pickingReport.model');
const PickingErrorReport = require('../models/pickingErrorReport.model');

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

function resolveResponsibleId(req) {
  const sessionUser = req.user || req.session?.user || null;

  if (sessionUser) {
    return normalizeResponsibleId(sessionUser.username || sessionUser.email || sessionUser.id);
  }

  return '';
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
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
    const responsableId = resolveResponsibleId(req);
    const numeroPedido = normalizeOrderNumber(req.body?.numeroPedido);
    const numeroCajas = parsePositiveInteger(req.body?.numeroCajas);

    if (!responsableId || !numeroPedido || !numeroCajas) {
      return res.status(400).json({
        message: 'Se requiere una sesion valida del almacenista, numeroPedido y numeroCajas.',
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

    const orderNumbers = details
      .map((report) => normalizeOrderNumber(report?.numeroPedido))
      .filter(Boolean);
    const errorRanking = orderNumbers.length
      ? await PickingErrorReport.aggregate([
          {
            $match: {
              numeroPedido: { $in: orderNumbers },
            },
          },
          {
            $group: {
              _id: '$responsableId',
              totalErrores: { $sum: 1 },
            },
          },
          { $sort: { totalErrores: -1, _id: 1 } },
        ])
      : [];

    const totalsRow = totals[0] || { totalPedidos: 0, totalCajas: 0, responsablesActivos: [] };
    const errorMap = new Map(errorRanking.map((item) => [item._id, item.totalErrores]));
    const totalErrores = errorRanking.reduce((sum, item) => sum + (Number(item.totalErrores) || 0), 0);

    return res.status(200).json({
      filtro: {
        desde: range.start,
        hasta: range.end,
      },
      resumen: {
        totalPedidos: totalsRow.totalPedidos || 0,
        totalCajas: totalsRow.totalCajas || 0,
        totalErrores,
        responsablesActivos: Array.isArray(totalsRow.responsablesActivos) ? totalsRow.responsablesActivos.length : 0,
        responsableConMasPicking: topWorker[0]
          ? {
              responsableId: topWorker[0]._id,
              totalPedidos: topWorker[0].totalPedidos,
              totalCajas: topWorker[0].totalCajas,
            }
          : null,
        responsableConMasErrores: errorRanking[0]
          ? {
              responsableId: errorRanking[0]._id,
              totalErrores: errorRanking[0].totalErrores,
            }
          : null,
      },
      ranking: ranking.map((item) => ({
        responsableId: item._id,
        totalPedidos: item.totalPedidos,
        totalCajas: item.totalCajas,
        totalErrores: errorMap.get(item._id) || 0,
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

async function getPickingReportByOrderNumber(req, res) {
  try {
    const numeroPedido = normalizeOrderNumber(req.params?.numeroPedido || req.query?.numeroPedido);

    if (!numeroPedido) {
      return res.status(400).json({ message: 'El numero de pedido es obligatorio.' });
    }

    const report = await PickingReport.findOne({ numeroPedido }).lean();

    if (!report) {
      return res.status(404).json({ message: 'No se encontro un picking para ese pedido.' });
    }

    const totalErrores = await PickingErrorReport.countDocuments({ numeroPedido });

    return res.status(200).json({
      report: {
        ...report,
        totalErrores,
      },
    });
  } catch (error) {
    console.error('Error consultando picking por numero de pedido:', error);
    return res.status(500).json({ message: 'Error consultando el picking por pedido.' });
  }
}

async function createPickingErrorReport(req, res) {
  try {
    const numeroPedido = normalizeOrderNumber(req.params?.numeroPedido || req.body?.numeroPedido);
    const tipoError = normalizeText(req.body?.tipoError);
    const descripcion = normalizeText(req.body?.descripcion);

    if (!numeroPedido || !tipoError || !descripcion) {
      return res.status(400).json({ message: 'numeroPedido, tipoError y descripcion son obligatorios.' });
    }

    const pickingReport = await PickingReport.findOne({ numeroPedido });

    if (!pickingReport) {
      return res.status(404).json({ message: 'No se encontro un picking para ese pedido.' });
    }

    const errorReport = await PickingErrorReport.create({
      pickingReportId: pickingReport._id,
      numeroPedido: pickingReport.numeroPedido,
      responsableId: pickingReport.responsableId,
      numeroCajas: pickingReport.numeroCajas,
      tipoError,
      descripcion,
    });

    return res.status(201).json({
      message: 'Reporte de error de picking guardado correctamente.',
      errorReport,
      report: pickingReport,
    });
  } catch (error) {
    console.error('Error guardando reporte de error de picking:', error);
    return res.status(500).json({ message: 'Error guardando el reporte de error de picking.' });
  }
}

module.exports = {
  createPickingReport,
  listRecentPickingReports,
  getPickingSummary,
  getPickingReportById,
  getPickingReportByOrderNumber,
  createPickingErrorReport,
};
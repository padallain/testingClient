const mongoose = require('mongoose');
const PickingReport = require('../models/pickingReport.model');
const PickingErrorReport = require('../models/pickingErrorReport.model');

const DAILY_PICKING_TARGET = Math.max(Number(process.env.PICKING_DAILY_TARGET || 25) || 25, 1);

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

async function getMyDailyPickingSummary(req, res) {
  try {
    const responsableId = resolveResponsibleId(req);
    const range = parseDateRange({ fecha: req.query?.fecha || new Date().toISOString().slice(0, 10) });

    if (!responsableId) {
      return res.status(400).json({
        message: 'Se requiere una sesion valida del almacenista.',
      });
    }

    if (!range) {
      return res.status(400).json({
        message: 'Debes indicar una fecha valida.',
      });
    }

    const matchStage = {
      responsableId,
      fechaHoraRegistro: {
        $gte: range.start,
        $lte: range.end,
      },
    };

    const [totals, reportes] = await Promise.all([
      PickingReport.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: null,
            totalPedidos: { $sum: 1 },
            totalCajas: { $sum: '$numeroCajas' },
          },
        },
      ]),
      PickingReport.find(matchStage)
        .sort({ fechaHoraRegistro: -1 })
        .limit(8)
        .lean(),
    ]);

    const totalsRow = totals[0] || { totalPedidos: 0, totalCajas: 0 };
    const totalPedidos = Number(totalsRow.totalPedidos) || 0;
    const totalCajas = Number(totalsRow.totalCajas) || 0;
    const faltanPedidos = Math.max(DAILY_PICKING_TARGET - totalPedidos, 0);
    const isLowPicking = totalPedidos < DAILY_PICKING_TARGET;

    return res.status(200).json({
      filtro: {
        fecha: range.start,
      },
      resumen: {
        responsableId,
        totalPedidos,
        totalCajas,
        metaPedidos: DAILY_PICKING_TARGET,
        faltanPedidos,
        isLowPicking,
        estado: isLowPicking ? 'bajo' : 'en-meta',
      },
      reportes,
    });
  } catch (error) {
    console.error('Error consultando resumen diario de picking propio:', error);
    return res.status(500).json({
      message: 'Error consultando tu resumen diario de picking.',
    });
  }
}

async function getDailyWarehousePerformance(req, res) {
  try {
    const range = parseDateRange({ fecha: req.query?.fecha || new Date().toISOString().slice(0, 10) });

    if (!range) {
      return res.status(400).json({
        message: 'Debes indicar una fecha valida.',
      });
    }

    const matchStage = {
      fechaHoraRegistro: {
        $gte: range.start,
        $lte: range.end,
      },
    };

    const [totals, rankingRaw] = await Promise.all([
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
    ]);

    const ranking = rankingRaw.map((item) => {
      const totalPedidos = Number(item?.totalPedidos) || 0;
      const totalCajas = Number(item?.totalCajas) || 0;
      const faltanPedidos = Math.max(DAILY_PICKING_TARGET - totalPedidos, 0);

      return {
        responsableId: normalizeResponsibleId(item?._id),
        totalPedidos,
        totalCajas,
        faltanPedidos,
        isLowPicking: totalPedidos < DAILY_PICKING_TARGET,
      };
    });

    const totalsRow = totals[0] || { totalPedidos: 0, totalCajas: 0, responsablesActivos: [] };
    const topResponsables = ranking.slice(0, 5);
    const bajoMetaResponsables = ranking
      .filter((worker) => worker.isLowPicking)
      .sort((leftWorker, rightWorker) => {
        if (rightWorker.faltanPedidos !== leftWorker.faltanPedidos) {
          return rightWorker.faltanPedidos - leftWorker.faltanPedidos;
        }

        return String(leftWorker.responsableId).localeCompare(String(rightWorker.responsableId));
      });

    return res.status(200).json({
      filtro: {
        fecha: range.start,
      },
      resumen: {
        totalPedidos: Number(totalsRow.totalPedidos) || 0,
        totalCajas: Number(totalsRow.totalCajas) || 0,
        responsablesActivos: Array.isArray(totalsRow.responsablesActivos) ? totalsRow.responsablesActivos.length : 0,
        metaPedidosPorAlmacenista: DAILY_PICKING_TARGET,
        almacenistasBajoMeta: bajoMetaResponsables.length,
      },
      topResponsables,
      bajoMetaResponsables,
    });
  } catch (error) {
    console.error('Error consultando rendimiento diario de almacenistas:', error);
    return res.status(500).json({
      message: 'Error consultando el rendimiento diario de almacenistas.',
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

    const [totals, rankingRaw, details] = await Promise.all([
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
        { $sort: { _id: 1 } },
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
    const totalPedidosPeriodo = Number(totalsRow.totalPedidos) || 0;
    const totalCajasPeriodo = Number(totalsRow.totalCajas) || 0;

    const ranking = rankingRaw
      .map((item) => {
        const totalPedidos = Number(item.totalPedidos) || 0;
        const totalCajas = Number(item.totalCajas) || 0;
        const pedidoShare = totalPedidosPeriodo > 0 ? totalPedidos / totalPedidosPeriodo : 0;
        const cajasShare = totalCajasPeriodo > 0 ? totalCajas / totalCajasPeriodo : 0;
        const relacionPedidosCajas = Number((Math.sqrt(pedidoShare * cajasShare) * 100).toFixed(2));
        const cajasPorPedido = totalPedidos > 0
          ? Number((totalCajas / totalPedidos).toFixed(2))
          : 0;

        return {
          responsableId: item._id,
          totalPedidos,
          totalCajas,
          totalErrores: errorMap.get(item._id) || 0,
          pedidoShare: Number((pedidoShare * 100).toFixed(2)),
          cajasShare: Number((cajasShare * 100).toFixed(2)),
          cajasPorPedido,
          relacionPedidosCajas,
        };
      })
      .sort((leftWorker, rightWorker) => {
        if (rightWorker.relacionPedidosCajas !== leftWorker.relacionPedidosCajas) {
          return rightWorker.relacionPedidosCajas - leftWorker.relacionPedidosCajas;
        }

        if (rightWorker.totalPedidos !== leftWorker.totalPedidos) {
          return rightWorker.totalPedidos - leftWorker.totalPedidos;
        }

        if (rightWorker.totalCajas !== leftWorker.totalCajas) {
          return rightWorker.totalCajas - leftWorker.totalCajas;
        }

        return String(leftWorker.responsableId).localeCompare(String(rightWorker.responsableId));
      });

    const topWorker = ranking[0] || null;

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
        responsableConMasPicking: topWorker
          ? {
              responsableId: topWorker.responsableId,
              totalPedidos: topWorker.totalPedidos,
              totalCajas: topWorker.totalCajas,
              pedidoShare: topWorker.pedidoShare,
              cajasShare: topWorker.cajasShare,
              cajasPorPedido: topWorker.cajasPorPedido,
              relacionPedidosCajas: topWorker.relacionPedidosCajas,
            }
          : null,
        responsableConMasErrores: errorRanking[0]
          ? {
              responsableId: errorRanking[0]._id,
              totalErrores: errorRanking[0].totalErrores,
            }
          : null,
      },
      ranking,
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

async function updatePickingReport(req, res) {
  try {
    const { id } = req.params;
    const responsableId = normalizeResponsibleId(req.body?.responsableId);
    const numeroPedido = normalizeOrderNumber(req.body?.numeroPedido);
    const numeroCajas = parsePositiveInteger(req.body?.numeroCajas);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'El id del picking no es valido.' });
    }

    if (!responsableId || !numeroPedido || !numeroCajas) {
      return res.status(400).json({
        message: 'responsableId, numeroPedido y numeroCajas son obligatorios.',
      });
    }

    const pickingReport = await PickingReport.findById(id);

    if (!pickingReport) {
      return res.status(404).json({ message: 'Picking no encontrado.' });
    }

    const duplicatedOrder = await PickingReport.findOne({
      numeroPedido,
      _id: { $ne: id },
    }).lean();

    if (duplicatedOrder) {
      return res.status(409).json({
        message: 'Ya existe otro picking registrado con ese numero de pedido.',
      });
    }

    pickingReport.responsableId = responsableId;
    pickingReport.numeroPedido = numeroPedido;
    pickingReport.numeroCajas = numeroCajas;

    await pickingReport.save();

    await PickingErrorReport.updateMany(
      { pickingReportId: pickingReport._id },
      {
        $set: {
          numeroPedido: pickingReport.numeroPedido,
          responsableId: pickingReport.responsableId,
          numeroCajas: pickingReport.numeroCajas,
        },
      },
    );

    const totalErrores = await PickingErrorReport.countDocuments({
      pickingReportId: pickingReport._id,
    });

    return res.status(200).json({
      message: 'Picking actualizado correctamente.',
      report: {
        ...pickingReport.toObject(),
        totalErrores,
      },
    });
  } catch (error) {
    console.error('Error actualizando picking:', error);
    return res.status(500).json({ message: 'Error actualizando el picking.' });
  }
}

async function deletePickingReport(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'El id del picking no es valido.' });
    }

    const pickingReport = await PickingReport.findById(id);

    if (!pickingReport) {
      return res.status(404).json({ message: 'Picking no encontrado.' });
    }

    const deletedErrors = await PickingErrorReport.deleteMany({
      pickingReportId: pickingReport._id,
    });

    await pickingReport.deleteOne();

    return res.status(200).json({
      message: 'Picking eliminado correctamente.',
      report: pickingReport,
      deletedErrorReports: deletedErrors.deletedCount || 0,
    });
  } catch (error) {
    console.error('Error eliminando picking:', error);
    return res.status(500).json({ message: 'Error eliminando el picking.' });
  }
}

module.exports = {
  createPickingReport,
  listRecentPickingReports,
  getMyDailyPickingSummary,
  getDailyWarehousePerformance,
  getPickingSummary,
  getPickingReportById,
  getPickingReportByOrderNumber,
  createPickingErrorReport,
  updatePickingReport,
  deletePickingReport,
};
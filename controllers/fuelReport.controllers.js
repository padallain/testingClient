const FuelReport = require("../models/fuelReport.model");

const normalizePlaca = (placa) => (typeof placa === "string" ? placa.trim().toUpperCase() : "");
const normalizeText = (value) => (typeof value === "string" ? value.trim() : "");

const MAX_SINGLE_REFILL_LITERS = Number(process.env.FUEL_MAX_SINGLE_REFILL_LITERS || 150);
const MAX_DAILY_LITERS_BY_PLACA = Number(process.env.FUEL_MAX_DAILY_LITERS_BY_PLACA || 250);
const DUPLICATE_WINDOW_MINUTES = Number(process.env.FUEL_DUPLICATE_WINDOW_MINUTES || 20);
const MAX_KM_BETWEEN_REFILLS = Number(process.env.FUEL_MAX_KM_BETWEEN_REFILLS || 800);
const MIN_PRICE_PER_LITER = Number(process.env.FUEL_MIN_PRICE_PER_LITER || 0.1);
const MAX_PRICE_PER_LITER = Number(process.env.FUEL_MAX_PRICE_PER_LITER || 5);
const MAX_RECEIPT_IMAGE_KB = Number(process.env.FUEL_MAX_RECEIPT_IMAGE_KB || 1024);
const FUEL_PHOTO_RETENTION_DAYS = Number(process.env.FUEL_PHOTO_RETENTION_DAYS || 7);

const resolveRole = (req) => String(req.user?.role || req.session?.user?.role || "").trim().toLowerCase();
const isAdminRequest = (req) => Boolean(req.user?.isAdmin || resolveRole(req) === "admin");

const resolveReporterPayload = (req) => {
  const sessionUser = req.user || req.session?.user || null;
  return {
    id: String(sessionUser?.id || sessionUser?._id || "").trim(),
    username: String(sessionUser?.username || "").trim(),
    role: String(sessionUser?.role || "").trim().toLowerCase(),
    email: String(sessionUser?.email || "").trim().toLowerCase(),
  };
};

const normalizeReceiptNumber = (value) => normalizeText(value).toUpperCase();

const getPhotoRetentionDeadline = () => new Date(Date.now() + (FUEL_PHOTO_RETENTION_DAYS * 24 * 60 * 60 * 1000));

const markExpiredFuelPhotoReportsForDeletion = async () => {
  const result = await FuelReport.updateMany(
    {
      "photoRetention.status": "active",
      "photoRetention.expiresAt": { $lte: new Date() },
    },
    {
      $set: {
        "photoRetention.status": "pending_deletion",
        "photoRetention.deletionRequestedAt": new Date(),
      },
    },
  );

  return Number(result?.modifiedCount || 0);
};

const parseReceiptPhotoDataUrl = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  const match = normalized.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    return { error: "La foto del comprobante debe ser una imagen valida en formato base64." };
  }

  const mimeType = match[1].toLowerCase();
  const base64Payload = match[2];
  const estimatedBytes = Math.floor((base64Payload.length * 3) / 4);
  const sizeKb = Math.round((estimatedBytes / 1024) * 100) / 100;

  if (!["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(mimeType)) {
    return { error: "La foto del comprobante debe ser JPG, PNG o WEBP." };
  }

  if (sizeKb > MAX_RECEIPT_IMAGE_KB) {
    return { error: `La foto del comprobante supera el maximo permitido (${MAX_RECEIPT_IMAGE_KB} KB).` };
  }

  return {
    dataUrl: normalized,
    mimeType,
    sizeKb,
  };
};

const resolveDriverName = (req) => {
  const sessionUser = req.user || req.session?.user || null;

  if (!sessionUser) {
    return "";
  }

  if (typeof sessionUser.username === "string" && sessionUser.username.trim()) {
    return sessionUser.username.trim();
  }

  if (typeof sessionUser.email === "string" && sessionUser.email.trim()) {
    return sessionUser.email.trim();
  }

  return typeof sessionUser.id === "string" ? sessionUser.id.trim() : "";
};

const buildSecurityFlags = ({ liters, pricePerLiter, previousReport, odometerKm }) => {
  const flags = [];

  if (liters > (MAX_SINGLE_REFILL_LITERS * 0.9)) {
    flags.push("high-liters");
  }

  if (Number.isFinite(pricePerLiter) && (pricePerLiter < MIN_PRICE_PER_LITER || pricePerLiter > MAX_PRICE_PER_LITER)) {
    flags.push("price-per-liter-out-of-range");
  }

  if (previousReport) {
    const previousOdometer = Number(previousReport.odometerKm);
    if (Number.isFinite(previousOdometer) && odometerKm - previousOdometer > (MAX_KM_BETWEEN_REFILLS * 0.9)) {
      flags.push("near-max-distance-between-refills");
    }
  }

  return flags;
};

const createFuelReport = async (req, res) => {
  try {
    const role = resolveRole(req);

    if (!["chofer", "admin"].includes(role)) {
      return res.status(403).json({ message: "Solo choferes o administradores pueden registrar combustible." });
    }

    const chofer = resolveDriverName(req);
    const placa = normalizePlaca(req.body?.placa);
    const fuelType = String(req.body?.fuelType || "").trim().toLowerCase();
    const liters = Number(req.body?.liters);
    const odometerKm = Number(req.body?.odometerKm);
    const totalAmountRaw = req.body?.totalAmount;
    const totalAmount = totalAmountRaw === "" || totalAmountRaw == null ? null : Number(totalAmountRaw);
    const station = normalizeText(req.body?.station);
    const notes = normalizeText(req.body?.notes);
    const receiptNumber = normalizeReceiptNumber(req.body?.receiptNumber);
    const receiptPhotoParsed = parseReceiptPhotoDataUrl(req.body?.receiptPhotoDataUrl);
    const reportedAt = new Date();

    if (!chofer || !placa) {
      return res.status(400).json({ message: "Se requiere sesion valida del chofer y placa." });
    }

    if (!["gasoil", "gasolina"].includes(fuelType)) {
      return res.status(400).json({ message: "Selecciona un tipo de combustible valido." });
    }

    if (!Number.isFinite(liters) || liters <= 0) {
      return res.status(400).json({ message: "Los litros deben ser mayores a 0." });
    }

    if (liters > MAX_SINGLE_REFILL_LITERS) {
      return res.status(400).json({ message: `La recarga excede el maximo permitido (${MAX_SINGLE_REFILL_LITERS} L).` });
    }

    if (!Number.isFinite(odometerKm) || odometerKm < 0) {
      return res.status(400).json({ message: "El odometro es obligatorio para calcular consumo." });
    }

    if (totalAmount == null || !Number.isFinite(totalAmount) || totalAmount <= 0) {
      return res.status(400).json({ message: "El monto total es obligatorio y debe ser mayor a 0." });
    }

    if (!station || station.length < 3) {
      return res.status(400).json({ message: "La estacion es obligatoria para auditoria." });
    }

    if (!receiptNumber || receiptNumber.length < 4 || receiptNumber.length > 40) {
      return res.status(400).json({ message: "El numero de comprobante es obligatorio (4 a 40 caracteres)." });
    }

    if (!/^[A-Z0-9\-_/]+$/.test(receiptNumber)) {
      return res.status(400).json({ message: "El numero de comprobante solo puede usar letras, numeros y - _ /." });
    }

    if (!receiptPhotoParsed) {
      return res.status(400).json({ message: "La foto del comprobante es obligatoria." });
    }

    if (receiptPhotoParsed?.error) {
      return res.status(400).json({ message: receiptPhotoParsed.error });
    }

    const duplicatedReceipt = await FuelReport.findOne({ receiptNumber }).lean();
    if (duplicatedReceipt) {
      return res.status(409).json({ message: "Ese numero de comprobante ya fue registrado." });
    }

    const previousReport = await FuelReport.findOne({ placa }).sort({ reportedAt: -1 }).lean();

    if (previousReport) {
      const previousOdometerKm = Number(previousReport.odometerKm);
      const kmDelta = odometerKm - previousOdometerKm;

      if (Number.isFinite(previousOdometerKm) && kmDelta < 0) {
        return res.status(409).json({ message: "El odometro no puede retroceder respecto al ultimo registro." });
      }

      if (Number.isFinite(previousOdometerKm) && kmDelta > MAX_KM_BETWEEN_REFILLS) {
        return res.status(409).json({ message: `El salto de odometro supera el limite permitido (${MAX_KM_BETWEEN_REFILLS} km).` });
      }
    }

    const duplicateWindowStart = new Date(reportedAt.getTime() - (DUPLICATE_WINDOW_MINUTES * 60 * 1000));
    const recentDuplicate = await FuelReport.findOne({
      placa,
      odometerKm,
      reportedAt: { $gte: duplicateWindowStart },
    }).lean();

    if (recentDuplicate) {
      return res.status(409).json({
        message: `Ya existe una recarga para esta placa y odometro en los ultimos ${DUPLICATE_WINDOW_MINUTES} minutos.`,
      });
    }

    const dayStart = new Date(reportedAt);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const todaysAggregate = await FuelReport.aggregate([
      {
        $match: {
          placa,
          reportedAt: {
            $gte: dayStart,
            $lt: dayEnd,
          },
        },
      },
      {
        $group: {
          _id: null,
          litersTotal: { $sum: "$liters" },
        },
      },
    ]);

    const litersToday = Number(todaysAggregate[0]?.litersTotal || 0);
    if ((litersToday + liters) > MAX_DAILY_LITERS_BY_PLACA) {
      return res.status(409).json({
        message: `La placa ${placa} superaria el limite diario de ${MAX_DAILY_LITERS_BY_PLACA} L.`,
      });
    }

    const pricePerLiter = totalAmount / liters;
    const securityFlags = buildSecurityFlags({ liters, pricePerLiter, previousReport, odometerKm });
    const securityScore = securityFlags.length;
    const photoRetentionExpiresAt = getPhotoRetentionDeadline();

    const report = new FuelReport({
      chofer,
      placa,
      fuelType,
      liters,
      odometerKm,
      totalAmount,
      station,
      receiptNumber,
      pricePerLiter,
      securityFlags,
      securityScore,
      reportedBy: resolveReporterPayload(req),
      source: {
        ip: String(req.ip || req.headers["x-forwarded-for"] || "").trim(),
        userAgent: String(req.get("user-agent") || "").trim(),
      },
      receiptPhoto: {
        dataUrl: receiptPhotoParsed.dataUrl,
        mimeType: receiptPhotoParsed.mimeType,
        sizeKb: receiptPhotoParsed.sizeKb,
        capturedAt: reportedAt,
      },
      photoRetention: {
        expiresAt: photoRetentionExpiresAt,
        status: "active",
        deletionRequestedAt: null,
        deletedAt: null,
      },
      notes,
      reportedAt,
    });

    await report.save();

    return res.status(201).json({
      message: "Recarga de combustible registrada correctamente",
      report,
      audit: {
        securityFlags,
        securityScore,
      },
    });
  } catch (error) {
    console.log("Error guardando reporte de combustible:", error);
    return res.status(500).json({ message: "Error guardando el reporte de combustible" });
  }
};

const getFuelConsumptionByPlaca = async (req, res) => {
  try {
    await markExpiredFuelPhotoReportsForDeletion();

    const role = resolveRole(req);
    const isAdmin = isAdminRequest(req);
    const authenticatedDriver = resolveDriverName(req);
    const requestedDays = Number(req.query.days);
    const days = Number.isFinite(requestedDays) && requestedDays > 0
      ? Math.min(Math.round(requestedDays), 90)
      : 30;
    const placaFilter = normalizePlaca(req.query.placa);
    const choferFilterRaw = normalizeText(req.query.chofer);
    const choferFilter = isAdmin ? choferFilterRaw : authenticatedDriver;

    if (!isAdmin && role !== "chofer") {
      return res.status(403).json({ message: "Solo choferes y administradores pueden consultar consumo por camión." });
    }

    if (!isAdmin && choferFilterRaw && choferFilterRaw !== authenticatedDriver) {
      return res.status(403).json({ message: "No puedes consultar consumo de otro chofer." });
    }

    const startDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));
    const query = { reportedAt: { $gte: startDate } };

    if (placaFilter) {
      query.placa = placaFilter;
    }

    if (choferFilter) {
      query.chofer = choferFilter;
    }

    const rows = await FuelReport.aggregate([
      { $match: query },
      {
        $group: {
          _id: "$placa",
          placa: { $first: "$placa" },
          choferes: { $addToSet: "$chofer" },
          reports: { $sum: 1 },
          litersTotal: { $sum: "$liters" },
          amountTotal: { $sum: { $ifNull: ["$totalAmount", 0] } },
          avgPricePerLiter: { $avg: "$pricePerLiter" },
          maxOdometerKm: { $max: "$odometerKm" },
          minOdometerKm: { $min: "$odometerKm" },
          suspiciousReports: { $sum: { $cond: [{ $gt: ["$securityScore", 0] }, 1, 0] } },
        },
      },
      {
        $project: {
          _id: 0,
          placa: 1,
          choferes: 1,
          reports: 1,
          litersTotal: { $round: ["$litersTotal", 2] },
          amountTotal: { $round: ["$amountTotal", 2] },
          avgPricePerLiter: { $round: ["$avgPricePerLiter", 2] },
          maxOdometerKm: 1,
          minOdometerKm: 1,
          suspiciousReports: 1,
          distanceKm: {
            $round: [
              {
                $subtract: ["$maxOdometerKm", "$minOdometerKm"],
              },
              2,
            ],
          },
          kmPerLiter: {
            $cond: [
              { $gt: ["$litersTotal", 0] },
              { $round: [{ $divide: [{ $subtract: ["$maxOdometerKm", "$minOdometerKm"] }, "$litersTotal"] }, 2] },
              null,
            ],
          },
        },
      },
      { $sort: { litersTotal: -1, placa: 1 } },
    ]);

    return res.status(200).json({
      days,
      placa: placaFilter || null,
      chofer: choferFilter || null,
      summaryByPlaca: rows,
    });
  } catch (error) {
    console.log("Error obteniendo consumo por camión:", error);
    return res.status(500).json({ message: "Error obteniendo consumo por camión" });
  }
};

const listPendingFuelPhotoDeletion = async (req, res) => {
  try {
    if (!isAdminRequest(req)) {
      return res.status(403).json({ message: "Solo administradores pueden ver fotos pendientes de borrado." });
    }

    await markExpiredFuelPhotoReportsForDeletion();

    const candidates = await FuelReport.find({
      "photoRetention.status": "pending_deletion",
    })
      .select("placa chofer receiptNumber reportedAt photoRetention receiptPhoto.sizeKb")
      .sort({ reportedAt: -1 })
      .lean();

    return res.status(200).json({
      retentionDays: FUEL_PHOTO_RETENTION_DAYS,
      total: candidates.length,
      candidates,
    });
  } catch (error) {
    console.log("Error listando fotos pendientes de borrado:", error);
    return res.status(500).json({ message: "Error listando fotos pendientes de borrado" });
  }
};

const approveFuelPhotoDeletion = async (req, res) => {
  try {
    if (!isAdminRequest(req)) {
      return res.status(403).json({ message: "Solo administradores pueden aprobar eliminacion de fotos." });
    }

    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean) : [];
    if (!ids.length) {
      return res.status(400).json({ message: "Debes enviar al menos un id de reporte." });
    }

    const result = await FuelReport.updateMany(
      {
        _id: { $in: ids },
        "photoRetention.status": "pending_deletion",
      },
      {
        $set: {
          "photoRetention.status": "deleted",
          "photoRetention.deletedAt": new Date(),
          "receiptPhoto.dataUrl": "",
          "receiptPhoto.mimeType": "",
          "receiptPhoto.sizeKb": 0,
        },
      },
    );

    return res.status(200).json({
      message: "Eliminacion confirmada.",
      modifiedCount: Number(result?.modifiedCount || 0),
    });
  } catch (error) {
    console.log("Error aprobando eliminacion de fotos:", error);
    return res.status(500).json({ message: "Error aprobando eliminacion de fotos" });
  }
};

const getDailyFuelConsumptionFromReports = async (req, res) => {
  try {
    await markExpiredFuelPhotoReportsForDeletion();

    const role = resolveRole(req);
    const isAdmin = isAdminRequest(req);
    const authenticatedDriver = resolveDriverName(req);
    const requestedDays = Number(req.query.days);
    const days = Number.isFinite(requestedDays) && requestedDays > 0
      ? Math.min(Math.round(requestedDays), 60)
      : 14;
    const placaFilter = normalizePlaca(req.query.placa);
    const choferFilterRaw = normalizeText(req.query.chofer);
    const choferFilter = isAdmin ? choferFilterRaw : authenticatedDriver;

    if (!isAdmin && choferFilterRaw && choferFilterRaw !== authenticatedDriver) {
      return res.status(403).json({ message: "No puedes consultar consumo de otro chofer." });
    }

    if (!isAdmin && role !== "chofer") {
      return res.status(403).json({ message: "Solo choferes y administradores pueden consultar consumo." });
    }

    const startDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));

    const query = { reportedAt: { $gte: startDate } };

    if (placaFilter) {
      query.placa = placaFilter;
    }

    if (choferFilter) {
      query.chofer = choferFilter;
    }

    const records = await FuelReport.find(query)
      .sort({ placa: 1, reportedAt: 1 })
      .lean();

    const previousOdometerByPlaca = new Map();
    const summaryByDay = new Map();

    records.forEach((record) => {
      const dateKey = new Date(record.reportedAt || record.createdAt).toISOString().slice(0, 10);
      const placa = normalizePlaca(record.placa);
      const liters = Number(record?.liters) || 0;
      const totalAmount = Number(record?.totalAmount);
      const odometerKm = Number(record?.odometerKm);

      const currentSummary = summaryByDay.get(dateKey) || {
        date: dateKey,
        refills: 0,
        litersTotal: 0,
        amountTotal: 0,
        distanceKmTotal: 0,
        suspiciousCount: 0,
        kmPerLiter: null,
      };

      currentSummary.refills += 1;
      currentSummary.litersTotal += liters;

      if (Number.isFinite(totalAmount) && totalAmount >= 0) {
        currentSummary.amountTotal += totalAmount;
      }

      if (Array.isArray(record?.securityFlags) && record.securityFlags.length > 0) {
        currentSummary.suspiciousCount += 1;
      }

      const previousOdometer = previousOdometerByPlaca.get(placa);

      if (Number.isFinite(odometerKm) && Number.isFinite(previousOdometer) && odometerKm > previousOdometer && liters > 0) {
        currentSummary.distanceKmTotal += (odometerKm - previousOdometer);
      }

      if (Number.isFinite(odometerKm)) {
        previousOdometerByPlaca.set(placa, odometerKm);
      }

      summaryByDay.set(dateKey, currentSummary);
    });

    const daily = Array.from(summaryByDay.values())
      .sort((left, right) => left.date.localeCompare(right.date))
      .map((item) => ({
        date: item.date,
        refills: item.refills,
        litersTotal: Number(item.litersTotal.toFixed(2)),
        amountTotal: Number(item.amountTotal.toFixed(2)),
        distanceKmTotal: Number(item.distanceKmTotal.toFixed(2)),
        suspiciousCount: item.suspiciousCount,
        kmPerLiter: item.distanceKmTotal > 0 && item.litersTotal > 0
          ? Number((item.distanceKmTotal / item.litersTotal).toFixed(2))
          : null,
      }));

    return res.status(200).json({
      days,
      placa: placaFilter || null,
      chofer: choferFilter || null,
      totalRecords: records.length,
      daily,
    });
  } catch (error) {
    console.log("Error obteniendo consumo diario de combustible:", error);
    return res.status(500).json({ message: "Error obteniendo consumo diario de combustible" });
  }
};

const getFuelSecurityOverview = async (req, res) => {
  try {
    if (!isAdminRequest(req)) {
      return res.status(403).json({ message: "Solo administradores pueden ver alertas de combustible." });
    }

    const requestedDays = Number(req.query.days);
    const days = Number.isFinite(requestedDays) && requestedDays > 0
      ? Math.min(Math.round(requestedDays), 90)
      : 30;
    const startDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));

    const records = await FuelReport.find({
      reportedAt: { $gte: startDate },
      securityScore: { $gt: 0 },
    })
      .sort({ reportedAt: -1 })
      .limit(200)
      .lean();

    const totalSuspicious = records.length;
    const groupedByPlaca = {};

    records.forEach((record) => {
      const placa = normalizePlaca(record.placa);
      groupedByPlaca[placa] = (groupedByPlaca[placa] || 0) + 1;
    });

    return res.status(200).json({
      days,
      totalSuspicious,
      groupedByPlaca,
      records,
    });
  } catch (error) {
    console.log("Error obteniendo alertas de combustible:", error);
    return res.status(500).json({ message: "Error obteniendo alertas de combustible" });
  }
};

module.exports = {
  createFuelReport,
  getDailyFuelConsumptionFromReports,
  getFuelConsumptionByPlaca,
  getFuelSecurityOverview,
  listPendingFuelPhotoDeletion,
  approveFuelPhotoDeletion,
};

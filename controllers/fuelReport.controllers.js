const FuelReport = require("../models/fuelReport.model");

const normalizePlaca = (placa) => (typeof placa === "string" ? placa.trim().toUpperCase() : "");

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

const createFuelReport = async (req, res) => {
  try {
    const chofer = resolveDriverName(req);
    const placa = normalizePlaca(req.body?.placa);
    const fuelType = String(req.body?.fuelType || "").trim().toLowerCase();
    const liters = Number(req.body?.liters);
    const odometerKm = Number(req.body?.odometerKm);
    const totalAmountRaw = req.body?.totalAmount;
    const totalAmount = totalAmountRaw === "" || totalAmountRaw == null ? null : Number(totalAmountRaw);
    const station = typeof req.body?.station === "string" ? req.body.station.trim() : "";
    const notes = typeof req.body?.notes === "string" ? req.body.notes.trim() : "";

    if (!chofer || !placa) {
      return res.status(400).json({ message: "Se requiere sesion valida del chofer y placa." });
    }

    if (!["gasoil", "gasolina"].includes(fuelType)) {
      return res.status(400).json({ message: "Selecciona un tipo de combustible valido." });
    }

    if (!Number.isFinite(liters) || liters <= 0) {
      return res.status(400).json({ message: "Los litros deben ser mayores a 0." });
    }

    if (!Number.isFinite(odometerKm) || odometerKm < 0) {
      return res.status(400).json({ message: "El odometro es obligatorio para calcular consumo." });
    }

    if (totalAmount != null && (!Number.isFinite(totalAmount) || totalAmount < 0)) {
      return res.status(400).json({ message: "El monto total no es valido." });
    }

    const report = new FuelReport({
      chofer,
      placa,
      fuelType,
      liters,
      odometerKm,
      totalAmount,
      station,
      notes,
      reportedAt: new Date(),
    });

    await report.save();

    return res.status(201).json({
      message: "Recarga de combustible registrada correctamente",
      report,
    });
  } catch (error) {
    console.log("Error guardando reporte de combustible:", error);
    return res.status(500).json({ message: "Error guardando el reporte de combustible" });
  }
};

const getDailyFuelConsumptionFromReports = async (req, res) => {
  try {
    const requestedDays = Number(req.query.days);
    const days = Number.isFinite(requestedDays) && requestedDays > 0
      ? Math.min(Math.round(requestedDays), 60)
      : 14;
    const placaFilter = normalizePlaca(req.query.placa);
    const choferFilter = typeof req.query.chofer === "string" ? req.query.chofer.trim() : "";
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
        kmPerLiter: null,
      };

      currentSummary.refills += 1;
      currentSummary.litersTotal += liters;

      if (Number.isFinite(totalAmount) && totalAmount >= 0) {
        currentSummary.amountTotal += totalAmount;
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

module.exports = {
  createFuelReport,
  getDailyFuelConsumptionFromReports,
};

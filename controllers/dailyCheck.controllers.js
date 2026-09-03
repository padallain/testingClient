const DailyCheck = require("../models/dailyCheck.model");
const mongoose = require("mongoose");

const normalizePlaca = (placa) =>
	typeof placa === "string" ? placa.trim().toUpperCase() : "";

const normalizeChecklist = (checklist) =>
	Array.isArray(checklist)
		? checklist.map((item) => ({
				nombre: typeof item.nombre === "string" ? item.nombre.trim() : "",
				estado: item.estado,
				comentario: typeof item.comentario === "string" ? item.comentario.trim() : "",
			}))
		: [];

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

const hasInvalidChecklistItem = (checklist) =>
	checklist.find(
		(item) =>
			!item.nombre ||
			!["OK", "NO_OK"].includes(item.estado) ||
			(item.estado === "NO_OK" && !item.comentario),
	);

const normalizeFuelLoad = (fuelLoad) => {
	const didRefuel = Boolean(fuelLoad?.didRefuel);

	if (!didRefuel) {
		return {
			didRefuel: false,
			fuelType: "",
			liters: 0,
			odometerKm: null,
			totalAmount: null,
			station: "",
			notes: "",
		};
	}

	const fuelType = String(fuelLoad?.fuelType || "").trim().toLowerCase();
	const liters = Number(fuelLoad?.liters);
	const odometerKm = Number(fuelLoad?.odometerKm);
	const totalAmountRaw = fuelLoad?.totalAmount;
	const totalAmount = totalAmountRaw === "" || totalAmountRaw == null ? null : Number(totalAmountRaw);

	return {
		didRefuel,
		fuelType,
		liters,
		odometerKm,
		totalAmount,
		station: typeof fuelLoad?.station === "string" ? fuelLoad.station.trim() : "",
		notes: typeof fuelLoad?.notes === "string" ? fuelLoad.notes.trim() : "",
	};
};

const validateFuelLoad = (fuelLoad) => {
	if (!fuelLoad?.didRefuel) {
		return "";
	}

	if (!["gasoil", "gasolina"].includes(fuelLoad.fuelType)) {
		return "Selecciona el tipo de combustible (gasoil o gasolina).";
	}

	if (!Number.isFinite(fuelLoad.liters) || fuelLoad.liters <= 0) {
		return "Los litros cargados deben ser mayores a 0.";
	}

	if (!Number.isFinite(fuelLoad.odometerKm) || fuelLoad.odometerKm < 0) {
		return "El odometro en km es obligatorio para calcular consumo diario.";
	}

	if (fuelLoad.totalAmount != null && (!Number.isFinite(fuelLoad.totalAmount) || fuelLoad.totalAmount < 0)) {
		return "El monto total de combustible no es valido.";
	}

	return "";
};

const getRecentDailyChecks = async (req, res) => {
	try {
		const requestedLimit = Number(req.query.limit);
		const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
			? Math.min(requestedLimit, 50)
			: 20;

		const dailyChecks = await DailyCheck.find()
			.sort({ fechaHoraRegistro: -1 })
			.limit(limit);

		return res.status(200).json({
			total: dailyChecks.length,
			reportes: dailyChecks,
		});
	} catch (error) {
		console.log("Error obteniendo reportes recientes:", error);
		return res.status(500).json({
			message: "Error obteniendo los reportes recientes",
		});
	}
};

const createDailyCheck = async (req, res) => {
	try {
		const { placa, modelo, anio, checklist, observaciones } = req.body;
		const chofer = resolveDriverName(req);
		const normalizedFuelLoad = normalizeFuelLoad(req.body?.fuelLoad || {});

		if (!chofer || !placa || !modelo || !anio) {
			return res.status(400).json({
				message: "Se requiere una sesion valida del chofer, placa, modelo y anio.",
			});
		}

		if (!Array.isArray(checklist) || checklist.length === 0) {
			return res.status(400).json({
				message: "El checklist es obligatorio",
			});
		}

		const normalizedChecklist = normalizeChecklist(checklist);

		const invalidItem = hasInvalidChecklistItem(normalizedChecklist);

		if (invalidItem) {
			return res.status(400).json({
				message: "Cada item debe tener nombre, estado valido y comentario cuando sea No OK",
			});
		}

		const fuelLoadValidationMessage = validateFuelLoad(normalizedFuelLoad);

		if (fuelLoadValidationMessage) {
			return res.status(400).json({ message: fuelLoadValidationMessage });
		}

		const newDailyCheck = new DailyCheck({
			chofer: chofer.trim(),
			placa: normalizePlaca(placa),
			modelo: modelo.trim(),
			anio: Number(anio),
			checklist: normalizedChecklist,
			fuelLoad: normalizedFuelLoad,
			observaciones: typeof observaciones === "string" ? observaciones.trim() : "",
		});

		await newDailyCheck.save();

		return res.status(201).json({
			message: "Reporte diario guardado correctamente",
			dailyCheck: newDailyCheck,
		});
	} catch (error) {
		console.log("Error guardando daily check:", error);
		return res.status(500).json({
			message: "Error guardando el reporte diario",
		});
	}
};

const getDailyChecksByPlaca = async (req, res) => {
	try {
		const placa = normalizePlaca(req.params.placa);

		if (!placa) {
			return res.status(400).json({
				message: "La placa es obligatoria",
			});
		}

		const dailyChecks = await DailyCheck.find({ placa }).sort({ fechaHoraRegistro: -1 });

		if (!dailyChecks.length) {
			return res.status(404).json({
				message: "No se encontraron reportes para esa placa",
			});
		}

		return res.status(200).json({
			placa,
			total: dailyChecks.length,
			reportes: dailyChecks,
		});
	} catch (error) {
		console.log("Error obteniendo daily checks por placa:", error);
		return res.status(500).json({
			message: "Error obteniendo los reportes por placa",
		});
	}
};

const getDailyCheckById = async (req, res) => {
	try {
		const { id } = req.params;

		if (!mongoose.Types.ObjectId.isValid(id)) {
			return res.status(400).json({
				message: "El id del daily check no es valido",
			});
		}

		const dailyCheck = await DailyCheck.findById(id);

		if (!dailyCheck) {
			return res.status(404).json({
				message: "Reporte diario no encontrado",
			});
		}

		return res.status(200).json(dailyCheck);
	} catch (error) {
		console.log("Error obteniendo daily check:", error);
		return res.status(500).json({
			message: "Error obteniendo el reporte diario",
		});
	}
};

const updateDailyCheck = async (req, res) => {
	try {
		const { id } = req.params;
		const { chofer, placa, modelo, anio, checklist, observaciones } = req.body;
		const normalizedFuelLoad = normalizeFuelLoad(req.body?.fuelLoad || {});

		if (!mongoose.Types.ObjectId.isValid(id)) {
			return res.status(400).json({
				message: "El id del daily check no es valido",
			});
		}

		if (!chofer || !placa || !modelo || !anio) {
			return res.status(400).json({
				message: "Chofer, placa, modelo y anio son obligatorios",
			});
		}

		const normalizedChecklist = normalizeChecklist(checklist);

		if (!normalizedChecklist.length) {
			return res.status(400).json({
				message: "El checklist es obligatorio",
			});
		}

		if (hasInvalidChecklistItem(normalizedChecklist)) {
			return res.status(400).json({
				message: "Cada item debe tener nombre, estado valido y comentario cuando sea No OK",
			});
		}

		const fuelLoadValidationMessage = validateFuelLoad(normalizedFuelLoad);

		if (fuelLoadValidationMessage) {
			return res.status(400).json({ message: fuelLoadValidationMessage });
		}

		const dailyCheck = await DailyCheck.findById(id);

		if (!dailyCheck) {
			return res.status(404).json({
				message: "Reporte diario no encontrado",
			});
		}

		dailyCheck.chofer = chofer.trim();
		dailyCheck.placa = normalizePlaca(placa);
		dailyCheck.modelo = modelo.trim();
		dailyCheck.anio = Number(anio);
		dailyCheck.checklist = normalizedChecklist;
		dailyCheck.fuelLoad = normalizedFuelLoad;
		dailyCheck.observaciones = typeof observaciones === "string" ? observaciones.trim() : "";

		await dailyCheck.save();

		return res.status(200).json({
			message: "Reporte diario actualizado correctamente",
			dailyCheck,
		});
	} catch (error) {
		console.log("Error actualizando daily check:", error);
		return res.status(500).json({
			message: "Error actualizando el reporte diario",
		});
	}
};

const getDailyFuelConsumption = async (req, res) => {
	try {
		const requestedDays = Number(req.query.days);
		const days = Number.isFinite(requestedDays) && requestedDays > 0
			? Math.min(Math.round(requestedDays), 60)
			: 14;
		const placaFilter = normalizePlaca(req.query.placa);
		const choferFilter = typeof req.query.chofer === "string" ? req.query.chofer.trim() : "";
		const startDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));

		const query = {
			"fuelLoad.didRefuel": true,
			fechaHoraRegistro: { $gte: startDate },
		};

		if (placaFilter) {
			query.placa = placaFilter;
		}

		if (choferFilter) {
			query.chofer = choferFilter;
		}

		const records = await DailyCheck.find(query)
			.sort({ placa: 1, fechaHoraRegistro: 1 })
			.lean();

		const previousOdometerByPlaca = new Map();
		const summaryByDay = new Map();

		records.forEach((record) => {
			const dateKey = new Date(record.fechaHoraRegistro).toISOString().slice(0, 10);
			const placa = normalizePlaca(record.placa);
			const liters = Number(record?.fuelLoad?.liters) || 0;
			const totalAmount = Number(record?.fuelLoad?.totalAmount);
			const odometerKm = Number(record?.fuelLoad?.odometerKm);

			const currentSummary = summaryByDay.get(dateKey) || {
				date: dateKey,
				refills: 0,
				litersTotal: 0,
				amountTotal: 0,
				distanceKmTotal: 0,
				efficiencySampleCount: 0,
				kmPerLiter: null,
			};

			currentSummary.refills += 1;
			currentSummary.litersTotal += liters;

			if (Number.isFinite(totalAmount) && totalAmount >= 0) {
				currentSummary.amountTotal += totalAmount;
			}

			const previousOdometer = previousOdometerByPlaca.get(placa);

			if (Number.isFinite(odometerKm) && Number.isFinite(previousOdometer) && odometerKm > previousOdometer && liters > 0) {
				const distanceDeltaKm = odometerKm - previousOdometer;
				currentSummary.distanceKmTotal += distanceDeltaKm;
				currentSummary.efficiencySampleCount += 1;
			}

			if (Number.isFinite(odometerKm)) {
				previousOdometerByPlaca.set(placa, odometerKm);
			}

			summaryByDay.set(dateKey, currentSummary);
		});

		const daily = Array.from(summaryByDay.values())
			.sort((left, right) => left.date.localeCompare(right.date))
			.map((item) => {
				const litersTotal = Number(item.litersTotal.toFixed(2));
				const amountTotal = Number(item.amountTotal.toFixed(2));
				const distanceKmTotal = Number(item.distanceKmTotal.toFixed(2));
				const kmPerLiter = item.distanceKmTotal > 0 && item.litersTotal > 0
					? Number((item.distanceKmTotal / item.litersTotal).toFixed(2))
					: null;

				return {
					date: item.date,
					refills: item.refills,
					litersTotal,
					amountTotal,
					distanceKmTotal,
					kmPerLiter,
				};
			});

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

const deleteDailyCheck = async (req, res) => {
	try {
		const { id } = req.params;

		if (!mongoose.Types.ObjectId.isValid(id)) {
			return res.status(400).json({
				message: "El id del daily check no es valido",
			});
		}

		const deletedDailyCheck = await DailyCheck.findByIdAndDelete(id);

		if (!deletedDailyCheck) {
			return res.status(404).json({
				message: "Reporte diario no encontrado",
			});
		}

		return res.status(200).json({
			message: "Reporte diario eliminado correctamente",
			dailyCheck: deletedDailyCheck,
		});
	} catch (error) {
		console.log("Error eliminando daily check:", error);
		return res.status(500).json({
			message: "Error eliminando el reporte diario",
		});
	}
};

module.exports = {
	getRecentDailyChecks,
	createDailyCheck,
	getDailyCheckById,
	getDailyChecksByPlaca,
	getDailyFuelConsumption,
	updateDailyCheck,
	deleteDailyCheck,
};

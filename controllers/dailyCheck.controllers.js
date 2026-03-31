const DailyCheck = require("../models/dailyCheck.model");
const mongoose = require("mongoose");

const normalizePlaca = (placa) =>
	typeof placa === "string" ? placa.trim().toUpperCase() : "";

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
		const { chofer, placa, modelo, anio, checklist, observaciones } = req.body;

		if (!chofer || !placa || !modelo || !anio) {
			return res.status(400).json({
				message: "Chofer, placa, modelo y anio son obligatorios",
			});
		}

		if (!Array.isArray(checklist) || checklist.length === 0) {
			return res.status(400).json({
				message: "El checklist es obligatorio",
			});
		}

		const normalizedChecklist = checklist.map((item) => ({
			nombre: typeof item.nombre === "string" ? item.nombre.trim() : "",
			estado: item.estado,
			comentario: typeof item.comentario === "string" ? item.comentario.trim() : "",
		}));

		const invalidItem = normalizedChecklist.find(
			(item) =>
				!item.nombre ||
				!["OK", "NO_OK"].includes(item.estado) ||
				(item.estado === "NO_OK" && !item.comentario),
		);

		if (invalidItem) {
			return res.status(400).json({
				message: "Cada item debe tener nombre, estado valido y comentario cuando sea No OK",
			});
		}

		const newDailyCheck = new DailyCheck({
			chofer: chofer.trim(),
			placa: normalizePlaca(placa),
			modelo: modelo.trim(),
			anio: Number(anio),
			checklist: normalizedChecklist,
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

module.exports = {
	getRecentDailyChecks,
	createDailyCheck,
	getDailyCheckById,
	getDailyChecksByPlaca,
};

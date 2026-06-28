const mongoose = require('mongoose');

const zonaInputSchema = new mongoose.Schema(
  {
    nombre: { type: String, required: true, trim: true },
    clientes: { type: Number, default: 0, min: 0 },
    cajas: { type: Number, default: 0, min: 0 },
    valor_dolares: { type: Number, default: 0, min: 0 },
    kg: { type: Number, default: 0, min: 0 },
    dificil_acceso: { type: Boolean, default: false },
    ruta_larga: { type: Boolean, default: false },
  },
  { _id: false },
);

const planItemSchema = new mongoose.Schema(
  {
    vehiculo: { type: String, required: true, trim: true },
    nombre_vehiculo: { type: String, default: '', trim: true },
    tipo: { type: String, enum: ['camion', 'camioneta'], required: true },
    zonas: { type: [String], default: [] },
    kg_total: { type: Number, default: 0, min: 0 },
    capacidad_kg: { type: Number, default: 0, min: 0 },
    porcentaje_ocupacion: { type: Number, default: 0, min: 0 },
    valor_total_dolares: { type: Number, default: 0, min: 0 },
    clientes_total: { type: Number, default: 0, min: 0 },
    cajas_total: { type: Number, default: 0, min: 0 },
    motivo: { type: String, default: '', trim: true },
  },
  { _id: false },
);

const externoSchema = new mongoose.Schema(
  {
    zona: { type: String, required: true, trim: true },
    zonas: { type: [String], default: [] },
    valor_dolares: { type: Number, default: 0, min: 0 },
    kg_total: { type: Number, default: 0, min: 0 },
    clientes_total: { type: Number, default: 0, min: 0 },
    cajas_total: { type: Number, default: 0, min: 0 },
    razon: { type: String, default: '', trim: true },
    ganancia_neta_si_externo: { type: Number, default: 0 },
  },
  { _id: false },
);

const mananaSchema = new mongoose.Schema(
  {
    zona: { type: String, required: true, trim: true },
    zonas: { type: [String], default: [] },
    valor_dolares: { type: Number, default: 0, min: 0 },
    kg_total: { type: Number, default: 0, min: 0 },
    clientes_total: { type: Number, default: 0, min: 0 },
    cajas_total: { type: Number, default: 0, min: 0 },
    razon: { type: String, default: '', trim: true },
  },
  { _id: false },
);

const despachoSchema = new mongoose.Schema(
  {
    fecha: { type: Date, default: Date.now, index: true },
    zonas_input: { type: [zonaInputSchema], default: [] },
    costo_externo_referencia: { type: Number, default: 0, min: 0 },
    plan: { type: [planItemSchema], default: [] },
    zonas_externo: { type: [externoSchema], default: [] },
    zonas_mañana: { type: [mananaSchema], default: [] },
    recomendaciones: { type: [String], default: [] },
    estrategia: {
      criterio: { type: String, default: '', trim: true },
      combinaciones_evaluadas: { type: Number, default: 0, min: 0 },
      zonas_atendidas_hoy: { type: [String], default: [] },
    },
    resumen: {
      valor_despachado_hoy: { type: Number, default: 0, min: 0 },
      valor_pendiente: { type: Number, default: 0, min: 0 },
      vehiculos_usados: { type: Number, default: 0, min: 0 },
      vehiculos_libres: { type: Number, default: 0, min: 0 },
      necesita_externo: { type: Boolean, default: false },
      porcentaje_flota_usada: { type: Number, default: 0, min: 0 },
      camionetas_usadas: { type: Number, default: 0, min: 0 },
      camiones_usados: { type: Number, default: 0, min: 0 },
      camionetas_habilitadas: { type: Number, default: 0, min: 0 },
      camiones_habilitados: { type: Number, default: 0, min: 0 },
      camionetas_configuradas: { type: Number, default: 0, min: 0 },
      camiones_configurados: { type: Number, default: 0, min: 0 },
      clientes_despachados: { type: Number, default: 0, min: 0 },
      clientes_pendientes: { type: Number, default: 0, min: 0 },
    },
    disponibilidad_vehiculos: {
      camionetas: { type: [mongoose.Schema.Types.Mixed], default: [] },
      camiones: { type: [mongoose.Schema.Types.Mixed], default: [] },
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model('Despacho', despachoSchema);
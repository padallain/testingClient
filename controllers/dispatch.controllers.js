const path = require('path');
const { calculateOptimalDispatch, DEFAULT_FLEET } = require('../services/optimizador');
const { getDispatchTerritoryConfig } = require('../services/dispatchTerritoryConfig');

function normalizeProfitPercentage(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 100;
  }

  return Math.min(Math.max(parsed, 0), 100);
}

function buildLegacyZones(zonas, porcentajeUtilidad) {
  return Object.entries(zonas || {}).map(([nombre, data]) => ({
    id: data?.id || nombre,
    nombre,
    clientes: Number(data?.clientes) || 0,
    cajas: Number(data?.cajas) || 0,
    valor_facturado_dolares: Number(data?.valor) || 0,
    valor_dolares: (Number(data?.valor) || 0) * (porcentajeUtilidad / 100),
    porcentaje_utilidad: porcentajeUtilidad,
    kg: Number(data?.peso) || 0,
  }));
}

function buildLegacyAssignments(result, externalCost) {
  const assigned = result.plan.map((item) => ({
    vehiculo: item.nombre_vehiculo,
    tipo: item.tipo,
    zonas: item.zonas,
    peso: item.kg_total,
    valor: item.valor_total_dolares,
    valorFacturado: item.valor_facturado_total_dolares,
    clientes: item.clientes_total,
    cajas: item.cajas_total,
    estado: 'asignado',
    motivo: item.motivo,
  }));

  const external = result.zonas_externo.map((item) => ({
    vehiculo: 'Vehículo Externo',
    tipo: 'externo',
    zonas: item.zonas,
    peso: item.kg_total,
    valor: item.valor_dolares,
    valorFacturado: item.valor_facturado_dolares,
    clientes: item.clientes_total,
    cajas: item.cajas_total,
    estado: 'externo',
    costoExterno: externalCost,
    gananciaNeta: item.ganancia_neta_si_externo,
    motivo: item.razon,
  }));

  const tomorrow = result.zonas_mañana.map((item) => ({
    vehiculo: null,
    tipo: 'posponer',
    zonas: item.zonas,
    peso: item.kg_total,
    valor: item.valor_dolares,
    valorFacturado: item.valor_facturado_dolares,
    clientes: item.clientes_total,
    cajas: item.cajas_total,
    estado: 'posponer',
    costoExterno: externalCost,
    gananciaNeta: item.valor_dolares - externalCost,
    motivo: item.razon,
  }));

  return [...assigned, ...external, ...tomorrow];
}

exports.getDispatchPage = (req, res) => {
  res.sendFile(path.join(__dirname, '../public/dispatch.html'));
};

exports.getDispatchConfig = (req, res) => {
  res.json({
    success: true,
    territory: getDispatchTerritoryConfig(),
    fleetDefaults: {
      unidades: DEFAULT_FLEET.unidades.map((vehicle) => ({ ...vehicle })),
    },
  });
};

exports.calculateDispatch = (req, res) => {
  try {
    const { zonas, costoExterno, vehiculos, configZonas, porcentajeUtilidad } = req.body || {};

    if (!zonas || typeof zonas !== 'object') {
      return res.status(400).json({ error: 'Se requiere el objeto "zonas"' });
    }

    const externalCost = Number(costoExterno) || 0;
    const effectiveProfitPercentage = normalizeProfitPercentage(porcentajeUtilidad);
    const normalizedZones = buildLegacyZones(zonas, effectiveProfitPercentage).filter((zone) => zone.kg > 0 || zone.valor_dolares > 0 || zone.clientes > 0 || zone.cajas > 0);

    if (!normalizedZones.length) {
      return res.status(400).json({ error: 'No hay zonas activas con datos' });
    }

    const result = calculateOptimalDispatch({
      zonas: normalizedZones,
      costoExternoReferencia: externalCost,
      vehiculos,
      configZonas,
    });

    const asignaciones = buildLegacyAssignments(result, externalCost);

    res.json({
      success: true,
      fecha: result.fecha,
      costoExterno: externalCost,
      porcentajeUtilidadReferencia: effectiveProfitPercentage,
      zonasActivas: normalizedZones.map((zone) => zone.nombre),
      asignaciones,
      recomendaciones: result.recomendaciones,
      estrategia: result.estrategia,
      resumen: {
        vehiculosConfigurados: result.resumen.vehiculos_propios_configurados,
        vehiculosHabilitados: result.resumen.vehiculos_propios_habilitados,
        vehiculosUsados: result.resumen.vehiculos_propios_usados,
        vehiculosSinUsar: result.resumen.vehiculos_propios_habilitados - result.resumen.vehiculos_propios_usados,
        externosRequeridos: result.zonas_externo.length,
        rutasPospuestas: result.zonas_mañana.length,
        totalFacturadoDespachado: result.resumen.facturado_despachado_hoy,
        totalValorDespachado: result.resumen.valor_despachado_hoy,
        totalFacturadoPospuesto: result.resumen.facturado_pendiente,
        totalValorPospuesto: result.resumen.valor_pendiente,
        totalClientesDespachados: result.resumen.clientes_despachados,
        totalClientesPospuestos: result.resumen.clientes_pendientes,
      },
      disponibilidadVehiculos: {
        unidades: result.disponibilidad_vehiculos.unidades,
      },
      plan: result.plan,
      zonas_externo: result.zonas_externo,
      zonas_mañana: result.zonas_mañana,
    });
  } catch (error) {
    console.error('Error en calculateDispatch:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Error calculando el despacho' });
  }
};

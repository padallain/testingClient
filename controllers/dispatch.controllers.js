const path = require('path');
const { calculateOptimalDispatch } = require('../services/optimizador');

function buildLegacyZones(zonas) {
  return Object.entries(zonas || {}).map(([nombre, data]) => ({
    nombre,
    clientes: Number(data?.clientes) || 0,
    cajas: Number(data?.cajas) || 0,
    valor_dolares: Number(data?.valor) || 0,
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

exports.calculateDispatch = (req, res) => {
  try {
    const { zonas, costoExterno, vehiculos, configZonas } = req.body || {};

    if (!zonas || typeof zonas !== 'object') {
      return res.status(400).json({ error: 'Se requiere el objeto "zonas"' });
    }

    const externalCost = Number(costoExterno) || 0;
    const normalizedZones = buildLegacyZones(zonas).filter((zone) => zone.kg > 0 || zone.valor_dolares > 0 || zone.clientes > 0 || zone.cajas > 0);

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
      zonasActivas: normalizedZones.map((zone) => zone.nombre),
      asignaciones,
      recomendaciones: result.recomendaciones,
      estrategia: result.estrategia,
      resumen: {
        camionetasConfiguradas: result.resumen.camionetas_configuradas,
        camionetasHabilitadas: result.resumen.camionetas_habilitadas,
        camionetasUsadas: result.resumen.camionetas_usadas,
        camionetasSinUsar: result.resumen.camionetas_habilitadas - result.resumen.camionetas_usadas,
        camionesConfigurados: result.resumen.camiones_configurados,
        camionesHabilitados: result.resumen.camiones_habilitados,
        camionesUsados: result.resumen.camiones_usados,
        camionesSinUsar: result.resumen.camiones_habilitados - result.resumen.camiones_usados,
        externosRequeridos: result.zonas_externo.length,
        rutasPospuestas: result.zonas_mañana.length,
        totalValorDespachado: result.resumen.valor_despachado_hoy,
        totalValorPospuesto: result.resumen.valor_pendiente,
        totalClientesDespachados: result.resumen.clientes_despachados,
        totalClientesPospuestos: result.resumen.clientes_pendientes,
      },
      disponibilidadVehiculos: {
        camionetas: result.disponibilidad_vehiculos.camionetas,
        camiones: result.disponibilidad_vehiculos.camiones,
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

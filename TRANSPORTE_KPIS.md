# KPIs de transporte

La guia existente permanece en `RouteAssignment.loadGuide`. Los viajes se guardan en
`transporttrips` y la configuracion editable en `transportconfigurations`.
No se migran ni rellenan automaticamente los viajes antiguos.

## Uso

1. Abrir **KPIs de transporte > Parametros** y registrar vehiculos reales con tipo y capacidad.
2. Revisar parametros amarillos, tarifas y margen. Canter y Dongfeng requieren completar costos.
3. En crear ruta, activar **Datos de transporte del viaje**. Ingresar fecha operativa, vehiculo,
  zona y ruta comercial. El monto cargado procede de los pedidos de la guia. Esta pantalla
  usa solo planificacion: carga, capacidad, paradas previstas, tarifa y ayudante.
  Los km estimados y viaticos presupuestados son opcionales y se guardan aparte de los reales.
4. Usar **Estimar viaje** antes de salir. Supone devoluciones previstas cero y km estimados.
5. Guardar el borrador sin datos de regreso. Completar devoluciones, km reales, viaticos,
   litros cargados, cantidades entregadas, paradas atendidas y horarios en **Operacion > Terminar ruta**.
6. Cerrar el viaje para congelar guia, tarifa, configuracion y KPIs. El cierre no modifica
  el estado de despacho de la ruta desde el editor de KPIs. Un viaje cerrado no puede editarse desde este modulo.
7. Consultar por dia, semana (lunes) o mes. El Excel semanal admite un rango de hasta siete dias.

Los faltantes quedan en `null`, no se transforman en cero. Los reportes consultan viajes cerrados
por defecto; un agregado con viajes incompletos no publica un porcentaje ponderado enganoso.
Los costos/ventas/sobrecostos de esos grupos son sumas conocidas parciales y se informa la cobertura.
La guia se vuelve a copiar al cerrar; modificaciones posteriores de la ruta no cambian el viaje cerrado.

## Convenciones y supuestos aprobados

- USD; montos finales a centavos con aritmetica decimal, porcentajes como fracciones (2% = 0.02).
- Camion: 40 litros / 150 km exactos. L300: $0.50/l segun el ultimo modelo aprobado, editable.
- Ganancia estimada = venta entregada x margen antes del flete (4% editable) - costo del viaje.
  No es utilidad contable y no incluye otros costos del negocio.
- Viaticos se suman una sola vez, incluso en externos.
- Equipo de frio: parametro adicional diario; Dongfeng queda incompleto hasta definirlo.
- Zona horaria America/Caracas; las horas enviadas al API deben incluir offset o Z.
- A 2% exacto el semaforo es amarillo. Se compara sin redondear el porcentaje para decidir el color.
- Combustible: km/l cargado es orientativo, no equivale necesariamente a consumo real.
- Comparacion economica propia/externa no garantiza capacidad o disponibilidad del vehiculo.
- Equilibrio porcentual usa el costo comparable sin viaticos comunes, considera la base de tarifa
  y advierte cuando el minimo ya supera el costo propio. Sobre base cargada no se presenta como venta neta.
- No se inventan placas, nombres de transportistas reales, rutas comerciales o mediciones GPS.

## API

Todas las rutas estan bajo `/transport-kpis`, requieren sesion/token y rol administrador.

| Metodo | Recurso | Uso |
| --- | --- | --- |
| GET / PUT | /configuration | Leer/editar parametros; PUT requiere version vigente |
| PATCH | /trips/:routeId | Guardar borrador/cerrar; actualizacion requiere updatedAt vigente |
| GET | /guides/:routeId | Datos y KPIs de una guia; compatible con rutas sin viaje |
| GET | /guides | Listado con KPIs |
| GET | /aggregates | Agregados ponderados |
| GET | /comparison | Comparativo de viajes externos |
| POST | /planning | Estimacion sin guardar viaje |
| GET | /weekly.xlsx | Excel semanal |

Filtros: from, to (YYYY-MM-DD), vehicleId, driverId, zone, routeCode, carrierId, freightType,
status (closed por defecto, draft o all). Agregados: period (day/week/month) y groupBy
(vehicleId/driverId/zone/routeCode/carrierId/freightType). Se rechazan reportes mayores a 10.000
viajes; reducir el rango en lugar de recibir resultados truncados.

## Verificacion y ejemplo

Desde esta carpeta:

```powershell
npm run test:transport
npm run demo:transport
```

El ejemplo genera `Transporte_Ejemplo_Semanal.xlsx`, sin insertar documentos en MongoDB.
Los seis casos ficticios suman costo $655.17, venta $31,169.00, flete ponderado 2.10%
y sobrecosto por viaje $60.00. No representan operaciones reales de PAD.
El Excel es una exportacion de resultados del sistema, no un modelo de costos editable offline.

Instalar dependencias y reiniciar/publicar backend y frontend para habilitar el modulo.

## Terminar ruta y liquidar un viaje

Acceso de administrador: **Operacion > Terminar ruta** (`/finish-routes`).
Seleccionar una ruta con guia, completar transporte y elegir el resultado de entrega.

- **Entregado sin novedad** confirma devolucion cero y copia carga a entregado y paradas
  planificadas a atendidas. Revisar estos valores antes de confirmar.
- **Con devoluciones / rechazos** requiere seleccionar pedido, monto y motivo de cada devolucion.
  El total debe coincidir con el monto devuelto y no puede superar los pedidos originales.
- **Otras novedades** requiere observaciones y no admite importes devueltos.
- **Guardar borrador y calcular** conserva el trabajo sin cerrar ni terminar la ruta.
- **Liquidar y terminar ruta** congela la guia, incidencias, ruta, parametros y KPIs, registra
  el administrador y marca la ruta completada. Requiere horas, km, viaticos, cantidades
  entregadas cuando se conoce la carga y paradas atendidas. No fabrica marcas de despacho del chofer.
- **Descargar viaje completo** genera Excel con pedidos, devoluciones, ruta/paradas originales,
  incidencias, datos del viaje, KPIs y configuracion aplicada. **Respaldo JSON** conserva el registro completo.

Endpoints administrativos adicionales: GET `/routes-to-finish` (status active/completed/all,
maximo 500 rutas recientes), POST `/trips/:routeId/finish` y GET `/trips/:routeId/export`
(format xlsx/json), bajo `/transport-kpis`.

Los documentos de viaje y ruta se guardan en dos pasos. Si el viaje cierra pero falla el segundo
paso, el API devuelve 503 indicando que la liquidacion quedo guardada. Recargar y volver a
**Terminar ruta** permite completar ese paso sin alterar la liquidacion. No hay duplicacion de viajes.
Los viajes antiguos sin snapshot se exportan indicando que los datos de ruta/incidencias son actuales.
Esta liquidacion es administrativa y de costos, no registra transferencias ni pagos bancarios.

### Antes y despues de salir

`estimatedKm` y `estimatedAllowances` son datos de planificacion. No se copian a `km` ni
`allowances`. Crear la ruta no requiere indicar devoluciones cero, horarios reales o carga
entregada; esos campos permanecen en null hasta registrar los datos reales. La estimacion
usa venta prevista sin devoluciones, con resultados claramente identificados como estimados.
En Crear ruta no se ofrece cerrar el viaje. El enlace **Completar datos reales en Terminar ruta**
abre la liquidacion de la guia guardada. Viajes anteriores mantienen sus datos sin migraciones.
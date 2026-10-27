# Arreglar direccion

Modulo unico: `/fix-client-address`. Acceso desde Inicio y **Logistica > Arreglar direccion**.
Los antiguos `/report-client-location` y `/client-location-reports` redirigen al mismo modulo.

## Chofer

1. Buscar RIF/ID del cliente y seleccionar la sede cuando tenga varias.
2. Indicar el nombre de sede propuesto si aparece como Principal o hay que corregirlo.
   Se puede cambiar solo la sede conservando las coordenadas registradas. El nombre vacio indica Principal.
   Verificar el punto registrado y proponer latitud/longitud correctas. El boton GPS toma
   la ubicacion del dispositivo: usarlo estando en la direccion correcta.
3. Escribir direccion/referencia y motivo, y pulsar **Solicitar arreglo**.
4. Consultar Mis solicitudes: pendientes, aprobadas o rechazadas.

Enviar no cambia el cliente. El servidor identifica al chofer desde la sesion/token;
no acepta un nombre de reportante elegido por el solicitante. Un chofer solo ve sus solicitudes.

## Administrador

En el mismo modulo se muestran todas las solicitudes. Comparar punto original/propuesto,
revisar el motivo y aprobar o rechazar. Para rechazar, el motivo es obligatorio.
La aprobacion actualiza `Client.location` y, si se propone, `Client.sucursal` del documento elegido, sin
eliminar el cliente, cambiar RIF, horario, otras sedes ni reescribir rutas ya guardadas.
El historial y la confirmacion muestran la sede propuesta. No se permite usar el nombre de otra sede del mismo cliente.
Las rutas futuras utilizan el punto actualizado; rutas existentes conservan su snapshot.

La decision registra usuario y fecha, mantiene punto anterior y propuesta, y no admite
aprobar dos veces. Si el cliente cambio desde la solicitud, se bloquea la aprobacion:
rechazar y pedir una nueva solicitud basada en el punto vigente.

## Persistencia y seguridad

Se reutiliza `clientlocationreports` con campos opcionales nuevos: targetClientId,
sucursal, reporterId, proposedLocation, accuracyMeters, status, reviewedBy, reviewedAt y reviewNote.
Los reportes anteriores sin punto propuesto se conservan como historial; no se aprueban.
No se migran ni borran clientes o reportes automaticamente. El modulo no ofrece eliminacion.

Las coordenadas se validan en backend. Solicitar/consultar requiere rol chofer o admin;
aprobar/rechazar requiere admin. Sesion/token obligatorio. El listado admite hasta 500 registros.

La aprobacion usa una transaccion MongoDB para guardar el update del cliente y la revision
juntos. Requiere Atlas o un replica set; en una instancia standalone devuelve un error sin
aplicar cambios parciales. No se modifica la infraestructura automaticamente.

## API

- POST `/clientLocationReports`: clientId, sucursal actual, details, proposedLocation (latitude/longitude), accuracyMeters y proposedSucursal opcionales.
- GET `/clientLocationReports?status=pending`: pending/approved/rejected/all; legacy disponible para historial admin.
- POST `/clientLocationReports/:reportId/approve`: reviewNote opcional.
- POST `/clientLocationReports/:reportId/reject`: reviewNote obligatorio.

Pruebas desde backend root: `node --test src/services/clientAddressCorrection.test.js`.
Las pruebas HTTP utilizan modelos simulados; no actualizan clientes reales.
Publicar/reiniciar backend y frontend para habilitar el flujo en produccion.
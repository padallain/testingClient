# Empresas por pedido en guias de carga

En **Crear ruta**, seleccionar **Empresa del pedido** antes de agregar al cliente.
El boton **+** permite registrar una empresa. La primera empresa queda como predeterminada;
las siguientes solo cambian la predeterminada si se marca **Usar como predeterminada** o se
pulsa el boton de estrella junto al selector.

La predeterminada es compartida por el sistema y se guarda en MongoDB, no en el navegador.
Al agregar un pedido, el selector vuelve a la predeterminada para el siguiente pedido.
Cada fila conserva su propia empresa y permite cambiarla antes de guardar la guia.
Cambiar la predeterminada no cambia filas ya agregadas ni guias anteriores.

## Datos y compatibilidad

- Catalogo: coleccion `dispatchcompanies`, con nombre e identificador.
- Predeterminada: documento `default` de `dispatchcompanysettings`.
- Pedidos: `RouteAssignment.loadGuide.orders[].companyId` y `companyName`.
- El nombre historico se copia del catalogo en el backend; no se confia en nombres enviados
  por el navegador. No hay migracion ni asignacion automatica a guias antiguas.
- Dos empresas pueden tener el mismo documento y cliente en una guia mixta. Se rechaza
  repetir el documento para la misma empresa, cliente y sede.
- PDF, detalle de liquidacion, devoluciones, Excel individual y respaldo JSON conservan
  la empresa. Guias antiguas sin datos de empresa aparecen como **Sin empresa registrada**.
- No se crean empresas ficticias ni se cargan nombres automaticamente en produccion.
- No se modifican calculos de costos o se distribuye el costo del viaje entre empresas.

## API

Todas estas rutas requieren sesion/token y rol administrador:

| Metodo | Recurso | Uso |
| --- | --- | --- |
| GET | /dispatch-companies | Catalogo y defaultCompanyId |
| POST | /dispatch-companies | Crear con name y makeDefault opcional |
| PUT | /dispatch-companies/default | Seleccionar predeterminada con companyId |

`POST /makeRoute` acepta `loadGuide.orders[].companyId`. Si falta, usa la predeterminada
actual solo para ese pedido nuevo. Si no hay predeterminada o el ID no existe, rechaza
el pedido con un error explicito. Los nombres duplicados se detectan sin diferencias
de mayusculas, espacios consecutivos o formas Unicode equivalentes.

## Verificacion

Desde esta carpeta: `npm run test:guides`.
Las pruebas usan modelos simulados y no insertan empresas de prueba en MongoDB.
Reiniciar/publicar backend y frontend antes de registrar empresas reales.

## Actualizar una guia existente

Despues del primer guardado, el boton cambia a **Actualizar guia**. Agregar pedidos o
clientes y guardar actualiza el mismo folio por PATCH `/driver-routes/:routeId/guide`.
La fecha original y numero de guia se conservan. Los clientes nuevos se combinan con
el orden vigente y los clientes eliminados dejan de formar parte de la guia.

El folio queda en la URL (`/routes?guideId=...`) para continuar la edicion al recargar.
En **Administrar rutas**, **Editar guia y pedidos** abre la guia guardada.
**Nueva guia** limpia el formulario para crear otro registro, previa confirmacion.

Las actualizaciones requieren rol administrador y la version `updatedAt` vigente.
No se permite modificar guias de rutas terminadas ni de viajes liquidados.
Una solicitud fallida no convierte la siguiente actualizacion en una creacion.

Las paradas se identifican por RIF/ID y sucursal. El mismo RIF puede aparecer en
sedes diferentes y varios pedidos de una misma sede se consolidan como una parada.
En Mi ruta se puede elegir la sede al agregar un cliente. Marcar, ordenar y quitar
paradas conserva esa identidad, sin afectar a otras sucursales del mismo cliente.

## Estrella de prioridad al editar

Marcar la estrella recalcula la vista previa desde esa parada: la sede marcada queda
primero y las demas se organizan desde ella. La vista previa no crea ni modifica guias.
**Actualizar guia** guarda ese orden en el mismo folio y conserva la prioridad al reabrir.
Con una prioridad marcada, el orden anterior no reemplaza el recorrido calculado.

En **Mi ruta**, la estrella aplica tambien a la vista y al guardar la personalizacion.
La prioridad se identifica por RIF/ID y sede; dos sucursales no comparten la estrella.
El modo espejo conserva la prioridad como primera parada y altera solo las restantes.
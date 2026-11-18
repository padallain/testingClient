# API de correos y recordatorios (admin)

El chequeo diario envia el recordatorio matutino a las 08:00 y el reporte de estado
a las 10:00, hora de `America/Caracas`. La zona se puede cambiar con
`DAILY_CHECK_TIMEZONE`; el reporte incluye los chequeos registrados durante ese dia local.

## Reporte diario en Render

Usa un servicio **Cron Job** separado para el reporte (el temporizador del servidor web no lo envia):

- Runtime: Node.
- Build command: `npm ci`.
- Command: `npm run cron:daily-check`.
- Schedule: `0 14 * * *` (UTC, equivale a las 10:00 de Caracas).
- Variables: copia las variables de MongoDB y correo del backend y configura `DAILY_CHECK_TIMEZONE=America/Caracas`.

El Cron Job conecta a MongoDB, envia un reporte y termina. El servidor web conserva el recordatorio de las 08:00, pero no envia el reporte de las 10:00 para evitar duplicados.

Estos endpoints permiten probar envio de correos, WhatsApp y mandar recordatorios.

Requisitos:

- Sesion iniciada como usuario admin.
- Variables de correo configuradas (`EMAIL_PROVIDER`, `EMAIL_USER`, `EMAIL_PASS`, etc.).
- Si usaras WhatsApp: variables `WHATSAPP_ACCESS_TOKEN` y `WHATSAPP_PHONE_NUMBER_ID`.

## 1) Correo de prueba

`POST /internal/admin/notifications/email-test`

Body JSON:

```json
{
  "to": "destinatario@dominio.com",
  "subject": "Prueba de correo",
  "message": "Hola, este es un correo de prueba."
}
```

Respuesta esperada: `200` con `Correo de prueba enviado correctamente`.

## 2) Recordatorio por email

`POST /internal/admin/notifications/reminder-email`

Body JSON:

```json
{
  "title": "Recordatorio de despacho",
  "body": "Recuerda completar el despacho antes de las 5:00 PM.",
  "roles": ["user"],
  "recipientEmails": ["supervisor@dominio.com"],
  "onlyApproved": true
}
```

Notas:

- `roles` admite `user` o `admin`.
- `recipientEmails` es opcional. Se mezcla con correos de usuarios por rol.
- `onlyApproved=true` envia solo a usuarios aprobados.
- Si hay errores parciales, la respuesta incluye `results` por destinatario.

## 3) WhatsApp de prueba

`POST /internal/admin/notifications/whatsapp-test`

Body JSON:

```json
{
  "to": "573001112233",
  "message": "Prueba de WhatsApp desde MakeRoute"
}
```

Opcional con plantilla:

```json
{
  "to": "573001112233",
  "templateName": "mi_plantilla",
  "templateLanguageCode": "es",
  "templateParams": ["param1", "param2"]
}
```

## 4) Recordatorio por WhatsApp

`POST /internal/admin/notifications/reminder-whatsapp`

Body JSON:

```json
{
  "title": "Recordatorio de despacho",
  "body": "Recuerda completar el despacho antes de las 5:00 PM.",
  "roles": ["user"],
  "recipientPhones": ["573001112233"],
  "onlyApproved": true
}
```

Notas:

- `recipientPhones` es opcional. Se mezcla con telefonos de usuarios por rol.
- Para usar telefonos por rol, los usuarios deben tener `phone` o `whatsappNumber` guardado.
- Puedes enviar por plantilla agregando `templateName`, `templateLanguageCode`, `templateParams`.

## Problemas comunes

- `EMAIL_AUTH_FAILED`: revisa credenciales SMTP o API key de Resend.
- `EMAIL_TIMEOUT`: proveedor no responde a tiempo.
- `EMAIL_CONFIG_INVALID`: faltan variables de entorno.
- `WHATSAPP_CONFIG_INVALID`: faltan variables o numero invalido.
- `WHATSAPP_TIMEOUT`: timeout de red contra Meta.
- `WHATSAPP_SEND_FAILED`: token/numero/plantilla rechazados por Meta.

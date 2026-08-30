# Configuracion WhatsApp (Meta Cloud API)

Este backend ahora soporta notificaciones por WhatsApp desde `services/sendWhatsApp.js`.

## Variables necesarias en `.env`

```env
WHATSAPP_ACCESS_TOKEN=EAAG...tu_token
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_API_VERSION=v21.0
WHATSAPP_TIMEOUT_MS=15000
WHATSAPP_LOG_ONLY=false
```

Notas:

- `WHATSAPP_ACCESS_TOKEN`: token de la app de Meta/WhatsApp Cloud API.
- `WHATSAPP_PHONE_NUMBER_ID`: ID del numero emisor configurado en Meta.
- `WHATSAPP_LOG_ONLY=true`: no envia a Meta, solo registra en consola (modo prueba local).

## Endpoints admin

Requiere sesion iniciada como admin.

### 1) WhatsApp de prueba

`POST /internal/admin/notifications/whatsapp-test`

Body JSON:

```json
{
  "to": "573001112233",
  "message": "Hola, prueba WhatsApp MakeRoute"
}
```

Opcional para plantillas:

```json
{
  "to": "573001112233",
  "templateName": "mi_plantilla",
  "templateLanguageCode": "es",
  "templateParams": ["param1", "param2"]
}
```

### 2) Recordatorio masivo por WhatsApp

`POST /internal/admin/notifications/reminder-whatsapp`

Body JSON:

```json
{
  "title": "Recordatorio",
  "body": "No olvides completar la tarea de hoy.",
  "roles": ["user"],
  "recipientPhones": ["573001112233"],
  "onlyApproved": true
}
```

Campos opcionales:

- `templateName`
- `templateLanguageCode`
- `templateParams`

## Problemas comunes

- `WHATSAPP_CONFIG_INVALID`: faltan variables de entorno o numero invalido.
- `WHATSAPP_TIMEOUT`: timeout de red hacia la API de Meta.
- `WHATSAPP_SEND_FAILED`: Meta rechazo el envio (token, numero o plantilla).

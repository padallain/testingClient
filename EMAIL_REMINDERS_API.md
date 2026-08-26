# API de correos y recordatorios (admin)

Estos endpoints permiten probar envio de correos y mandar recordatorios por email.

Requisitos:

- Sesion iniciada como usuario admin.
- Variables de correo configuradas (`EMAIL_PROVIDER`, `EMAIL_USER`, `EMAIL_PASS`, etc.).

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

## Problemas comunes

- `EMAIL_AUTH_FAILED`: revisa credenciales SMTP o API key de Resend.
- `EMAIL_TIMEOUT`: proveedor no responde a tiempo.
- `EMAIL_CONFIG_INVALID`: faltan variables de entorno.

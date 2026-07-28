# Configuracion Google (Gmail) para recuperacion de contrasena

Este backend envia el codigo de recuperacion desde `services/sendEmail.js` usando Nodemailer.

## Variables necesarias en `.env`

```env
EMAIL_SERVICE=gmail
EMAIL_USER=easymovelogisticsinternational@gmail.com
EMAIL_PASS=TU_APP_PASSWORD_DE_GOOGLE
EMAIL_FROM=MakeRoute <easymovelogisticsinternational@gmail.com>
EMAIL_LOG_ONLY=false
```

## Recomendado para Render (evitar timeout SMTP)

Si Render da error `EMAIL_TIMEOUT`, usa Resend como proveedor principal:

```env
EMAIL_PROVIDER=resend
RESEND_API_KEY=tu_api_key
RESEND_FROM=onboarding@resend.dev
EMAIL_LOG_ONLY=false
```

Notas:

- `RESEND_FROM` debe ser un remitente permitido por tu cuenta de Resend.
- Cuando uses `EMAIL_PROVIDER=resend`, no dependes de puertos SMTP de Google.

## Si quieres usar Gmail personal como remitente real (SMTP)

En Render configura estas variables:

```env
EMAIL_PROVIDER=smtp
EMAIL_SERVICE=gmail
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=465
EMAIL_SECURE=true
EMAIL_USER=tu_correo_gmail@gmail.com
EMAIL_PASS=tu_app_password_de_google
EMAIL_FROM=MakeRoute <tu_correo_gmail@gmail.com>
EMAIL_LOG_ONLY=false
EMAIL_CONNECTION_TIMEOUT_MS=30000
EMAIL_GREETING_TIMEOUT_MS=30000
EMAIL_SOCKET_TIMEOUT_MS=45000
EMAIL_SMTP_DISABLE_FALLBACK=true
```

Notas:

- `EMAIL_PASS` debe ser App Password de Google, no la clave normal.
- Si aun asi hay timeout en Render, vuelve a `EMAIL_PROVIDER=resend` porque es una limitacion de salida SMTP del hosting.

## Como obtener `EMAIL_PASS` (App Password)

1. Entra a la cuenta de Google usada en `EMAIL_USER`.
2. Activa verificacion en dos pasos (2FA).
3. Ve a Seguridad -> Contrasenas de aplicaciones.
4. Crea una nueva contrasena de aplicacion (Mail).
5. Copia la clave de 16 caracteres y pegala en `EMAIL_PASS`.

## Importante

- No uses la contrasena normal de Gmail en `EMAIL_PASS`.
- Si despliegas en Render u otro hosting, configura estas mismas variables en el panel de entorno del servicio remoto.
- Si `EMAIL_LOG_ONLY=true`, no se enviaran correos reales.

## Validacion rapida

1. Reinicia el backend.
2. Llama al endpoint:

```http
POST /recover-password/request-code
Content-Type: application/json

{ "email": "correo-existente@dominio.com" }
```

3. Si esta bien configurado, el usuario recibe un codigo de 6 digitos por correo.
4. Si falla auth, el backend respondera con mensaje relacionado a `EMAIL_AUTH_FAILED`.

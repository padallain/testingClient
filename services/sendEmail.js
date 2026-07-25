const nodemailer = require("nodemailer");
const { Resend } = require("resend");

function buildConfigError(message) {
  return new Error(`EMAIL_CONFIG_INVALID: ${message}`);
}

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    return null;
  }

  return new Resend(apiKey);
}

function buildTransportConfig() {
  const host = process.env.EMAIL_HOST;
  const port = Number(process.env.EMAIL_PORT || 587);
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  const service = process.env.EMAIL_SERVICE;
  const connectionTimeout = Number(process.env.EMAIL_CONNECTION_TIMEOUT_MS || 10000);
  const greetingTimeout = Number(process.env.EMAIL_GREETING_TIMEOUT_MS || 10000);
  const socketTimeout = Number(process.env.EMAIL_SOCKET_TIMEOUT_MS || 15000);

  if (!user || !pass) {
    throw buildConfigError("Configura RESEND_API_KEY o, como alternativa, EMAIL_USER y EMAIL_PASS para SMTP.");
  }

  if (service) {
    return {
      service,
      auth: { user, pass },
      connectionTimeout,
      greetingTimeout,
      socketTimeout,
    };
  }

  if (!host) {
    throw buildConfigError("Si no usas Resend, EMAIL_HOST o EMAIL_SERVICE es obligatorio para SMTP.");
  }

  return {
    host,
    port,
    secure: String(process.env.EMAIL_SECURE || "false") === "true",
    auth: { user, pass },
    connectionTimeout,
    greetingTimeout,
    socketTimeout,
  };
}

function getDefaultFromAddress() {
  return process.env.EMAIL_FROM || process.env.EMAIL_USER || "no-reply@makeroute.local";
}

function getResendFromAddress() {
  const fromAddress = String(process.env.EMAIL_FROM || "").trim();

  if (!fromAddress) {
    throw buildConfigError("Cuando usas Resend debes configurar EMAIL_FROM con un remitente de un dominio verificado.");
  }

  return fromAddress;
}

async function sendWithResend({ to, subject, text, html, from }) {
  const resend = getResendClient();

  if (!resend) {
    return false;
  }

  const resendFrom = getResendFromAddress();
  const recipients = Array.isArray(to) ? to : [to];
  const { error } = await resend.emails.send({
    from: resendFrom || from,
    to: recipients,
    subject,
    text,
    html,
  });

  if (error) {
    const errorMessage = String(error.message || "");

    if (/api key|unauthorized|forbidden/i.test(errorMessage)) {
      throw new Error("EMAIL_AUTH_FAILED: la API key de Resend no es valida.");
    }

    if (/timeout|timed out|network|fetch failed|socket/i.test(errorMessage)) {
      throw new Error(`EMAIL_TIMEOUT: ${errorMessage}`);
    }

    throw new Error(`EMAIL_SEND_FAILED: ${errorMessage || "Resend no pudo enviar el correo."}`);
  }

  return true;
}

async function sendWithSmtp({ to, subject, text, html, from }) {
  const transporter = nodemailer.createTransport(buildTransportConfig());

  try {
    await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html,
    });
  } catch (error) {
    if (error?.code === "EAUTH") {
      throw new Error("EMAIL_AUTH_FAILED: credenciales SMTP invalidas o App Password incorrecto.");
    }

    if (error?.code === "ETIMEDOUT" || error?.code === "ESOCKET" || error?.code === "ECONNECTION") {
      throw new Error(`EMAIL_TIMEOUT: ${error.message}`);
    }

    throw new Error(`EMAIL_SEND_FAILED: ${error.message}`);
  }
}

async function sendEmail({ to, subject, text, html, from = getDefaultFromAddress() }) {
  if (String(process.env.EMAIL_LOG_ONLY || "false") === "true") {
    console.log("[email] log-only password recovery delivery", {
      to,
      subject,
      previewText: text,
    });
    return;
  }

  const usedResend = await sendWithResend({ to, subject, text, html, from });

  if (usedResend) {
    return;
  }

  await sendWithSmtp({ to, subject, text, html, from });
}

module.exports = {
  sendEmail,
};

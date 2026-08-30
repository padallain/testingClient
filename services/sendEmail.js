const nodemailer = require("nodemailer");
const axios = require("axios");

const RESEND_API_URL = "https://api.resend.com/emails";

function buildConfigError(message) {
  return new Error(`EMAIL_CONFIG_INVALID: ${message}`);
}

function normalizeEnvString(value) {
  return String(value ?? "").trim();
}

function buildTransportConfig() {
  const host = normalizeEnvString(process.env.EMAIL_HOST);
  const port = Number(normalizeEnvString(process.env.EMAIL_PORT || "587"));
  const user = normalizeEnvString(process.env.EMAIL_USER);
  const pass = normalizeEnvString(process.env.EMAIL_PASS);
  const service = normalizeEnvString(process.env.EMAIL_SERVICE);
  const connectionTimeout = Number(normalizeEnvString(process.env.EMAIL_CONNECTION_TIMEOUT_MS || "10000"));
  const greetingTimeout = Number(normalizeEnvString(process.env.EMAIL_GREETING_TIMEOUT_MS || "10000"));
  const socketTimeout = Number(normalizeEnvString(process.env.EMAIL_SOCKET_TIMEOUT_MS || "15000"));

  if (!user || !pass) {
    throw buildConfigError("EMAIL_USER y EMAIL_PASS son obligatorios para enviar correo por SMTP.");
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
    throw buildConfigError("EMAIL_HOST o EMAIL_SERVICE es obligatorio para SMTP.");
  }

  return {
    host,
    port,
    secure: normalizeEnvString(process.env.EMAIL_SECURE || "false").toLowerCase() === "true",
    auth: { user, pass },
    connectionTimeout,
    greetingTimeout,
    socketTimeout,
  };
}

function getDefaultFromAddress() {
  return normalizeEnvString(process.env.EMAIL_FROM || process.env.EMAIL_USER || "no-reply@makeroute.local");
}

function hasResendConfiguration() {
  return Boolean(normalizeEnvString(process.env.RESEND_API_KEY));
}

function shouldFallbackToResend(error) {
  const disableFallback = String(process.env.EMAIL_SMTP_DISABLE_FALLBACK || "false") === "true";

  if (disableFallback || !hasResendConfiguration()) {
    return false;
  }

  const message = String(error?.message || "");
  return message.startsWith("EMAIL_TIMEOUT:");
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

async function sendWithResend({ to, subject, text, html, from }) {
  const resendApiKey = normalizeEnvString(process.env.RESEND_API_KEY);
  const resendFrom = normalizeEnvString(process.env.RESEND_FROM || from || "");
  const recipient = normalizeEnvString(to);

  if (!resendApiKey) {
    throw buildConfigError("RESEND_API_KEY es obligatorio para enviar correo con Resend.");
  }

  if (!resendFrom) {
    throw buildConfigError("RESEND_FROM o EMAIL_FROM es obligatorio para enviar correo con Resend.");
  }

  try {
    await axios.post(
      RESEND_API_URL,
      {
        from: resendFrom,
        to: [recipient],
        subject,
        text,
        html,
      },
      {
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        timeout: Number(process.env.RESEND_TIMEOUT_MS || 15000),
      },
    );
  } catch (error) {
    if (error?.code === "ECONNABORTED") {
      throw new Error(`EMAIL_TIMEOUT: ${error.message}`);
    }

    const providerMessage = error?.response?.data
      ? JSON.stringify(error.response.data)
      : error.message;

    throw new Error(`EMAIL_SEND_FAILED: ${providerMessage}`);
  }
}

async function sendEmail({ to, subject, text, html, from = getDefaultFromAddress() }) {
  const logOnly = normalizeEnvString(process.env.EMAIL_LOG_ONLY || "false").toLowerCase() === "true";

  if (logOnly) {
    console.log("[email] log-only password recovery delivery", {
      to,
      subject,
      previewText: text,
    });
    return;
  }

  const provider = normalizeEnvString(process.env.EMAIL_PROVIDER || "smtp").toLowerCase();

  if (provider === "resend") {
    await sendWithResend({ to, subject, text, html, from });
    return;
  }

  try {
    await sendWithSmtp({ to, subject, text, html, from });
  } catch (error) {
    if (!shouldFallbackToResend(error)) {
      throw error;
    }

    console.warn("[email] SMTP timeout detected. Falling back to Resend provider.");
    await sendWithResend({ to, subject, text, html, from });
  }
}

module.exports = {
  sendEmail,
};

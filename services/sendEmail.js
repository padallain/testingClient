const nodemailer = require("nodemailer");

function buildConfigError(message) {
  return new Error(`EMAIL_CONFIG_INVALID: ${message}`);
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
    throw buildConfigError("EMAIL_USER y EMAIL_PASS son obligatorios.");
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
    throw buildConfigError("EMAIL_HOST o EMAIL_SERVICE es obligatorio.");
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

async function sendEmail({ to, subject, text, html, from = getDefaultFromAddress() }) {
  if (String(process.env.EMAIL_LOG_ONLY || "false") === "true") {
    console.log("[email] log-only password recovery delivery", {
      to,
      subject,
      previewText: text,
    });
    return;
  }

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

module.exports = {
  sendEmail,
};

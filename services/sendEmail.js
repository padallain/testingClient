const nodemailer = require("nodemailer");

function buildTransportConfig() {
  const host = process.env.EMAIL_HOST;
  const port = Number(process.env.EMAIL_PORT || 587);
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  const service = process.env.EMAIL_SERVICE;

  if (service) {
    return {
      service,
      auth: user && pass ? { user, pass } : undefined,
    };
  }

  if (!host) {
    throw new Error("EMAIL_HOST or EMAIL_SERVICE is required to send emails");
  }

  return {
    host,
    port,
    secure: String(process.env.EMAIL_SECURE || "false") === "true",
    auth: user && pass ? { user, pass } : undefined,
  };
}

function getDefaultFromAddress() {
  return process.env.EMAIL_FROM || process.env.EMAIL_USER || "no-reply@makeroute.local";
}

async function sendEmail({ to, subject, text, html, from = getDefaultFromAddress() }) {
  const transporter = nodemailer.createTransport(buildTransportConfig());

  await transporter.sendMail({
    from,
    to,
    subject,
    text,
    html,
  });
}

module.exports = {
  sendEmail,
};

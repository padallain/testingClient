const User = require("../models/user.model");
const { sendEmail } = require("../services/sendEmail");

const ADMIN_ROLE = "admin";
const USER_ROLE = "user";

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeRole(value) {
  const role = String(value || "").trim().toLowerCase();
  return role === ADMIN_ROLE ? ADMIN_ROLE : USER_ROLE;
}

function parseRecipientEmails(rawEmails) {
  if (!Array.isArray(rawEmails)) {
    return [];
  }

  return [...new Set(rawEmails.map((email) => normalizeEmail(email)).filter(Boolean))];
}

function resolveEmailErrorMessage(error) {
  const message = String(error?.message || "");

  if (message.startsWith("EMAIL_CONFIG_INVALID:")) {
    return "Configuracion de correo incompleta o invalida. Revisa EMAIL_PROVIDER y variables SMTP/Resend.";
  }

  if (message.startsWith("EMAIL_AUTH_FAILED:")) {
    return "Credenciales de correo invalidas. Revisa EMAIL_USER y EMAIL_PASS o API key de Resend.";
  }

  if (message.startsWith("EMAIL_TIMEOUT:")) {
    return "El proveedor de correo no respondio a tiempo. Intenta de nuevo o cambia de proveedor.";
  }

  return "No se pudo enviar el correo.";
}

function buildReminderMessage({ title, body }) {
  const normalizedTitle = String(title || "Recordatorio MakeRoute").trim() || "Recordatorio MakeRoute";
  const normalizedBody = String(body || "").trim();

  return {
    subject: normalizedTitle,
    text: [
      normalizedTitle,
      "",
      normalizedBody,
      "",
      "Mensaje enviado automaticamente por MakeRoute.",
    ].join("\n"),
    html: `
      <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;">
        <h2 style="margin-bottom: 10px;">${normalizedTitle}</h2>
        <p style="white-space: pre-line;">${normalizedBody || "Sin contenido"}</p>
        <p style="margin-top: 14px; color: #6b7280; font-size: 12px;">Mensaje enviado automaticamente por MakeRoute.</p>
      </div>
    `,
  };
}

const sendTestEmailByAdmin = async (req, res) => {
  try {
    const to = normalizeEmail(req.body?.to);
    const subject = String(req.body?.subject || "Prueba de correo MakeRoute").trim() || "Prueba de correo MakeRoute";
    const message = String(req.body?.message || "Este es un correo de prueba de MakeRoute.").trim() || "Este es un correo de prueba de MakeRoute.";

    if (!to) {
      return res.status(400).json({ message: "El campo 'to' es obligatorio." });
    }

    await sendEmail({
      to,
      subject,
      text: message,
      html: `<div style="font-family: Arial, sans-serif;"><p>${message}</p></div>`,
    });

    return res.status(200).json({
      message: "Correo de prueba enviado correctamente.",
      to,
      subject,
    });
  } catch (error) {
    console.log("Error sending test email:", error);
    return res.status(500).json({ message: resolveEmailErrorMessage(error) });
  }
};

const sendReminderEmailByAdmin = async (req, res) => {
  try {
    const title = String(req.body?.title || "Recordatorio MakeRoute").trim();
    const body = String(req.body?.body || "").trim();
    const recipientEmails = parseRecipientEmails(req.body?.recipientEmails);
    const requestedRoles = Array.isArray(req.body?.roles)
      ? req.body.roles.map((role) => normalizeRole(role))
      : [USER_ROLE];
    const roles = [...new Set(requestedRoles)];
    const onlyApproved = req.body?.onlyApproved !== false;

    if (!body) {
      return res.status(400).json({ message: "El campo 'body' es obligatorio." });
    }

    const usersFromRoles = await User.find({ role: { $in: roles } })
      .select("email isApproved")
      .lean();

    const roleEmails = usersFromRoles
      .filter((user) => !onlyApproved || user?.isApproved !== false)
      .map((user) => normalizeEmail(user?.email))
      .filter(Boolean);

    const finalRecipients = [...new Set([...recipientEmails, ...roleEmails])];

    if (finalRecipients.length === 0) {
      return res.status(400).json({
        message: "No hay destinatarios validos para enviar el recordatorio.",
      });
    }

    const reminderMessage = buildReminderMessage({ title, body });
    const sendResults = [];

    for (const to of finalRecipients) {
      try {
        await sendEmail({
          to,
          subject: reminderMessage.subject,
          text: reminderMessage.text,
          html: reminderMessage.html,
        });

        sendResults.push({ to, status: "sent" });
      } catch (error) {
        sendResults.push({
          to,
          status: "failed",
          error: resolveEmailErrorMessage(error),
        });
      }
    }

    const sentCount = sendResults.filter((item) => item.status === "sent").length;
    const failedCount = sendResults.length - sentCount;

    return res.status(200).json({
      message: failedCount === 0
        ? "Recordatorio enviado correctamente."
        : "Recordatorio enviado con errores parciales.",
      summary: {
        totalRecipients: finalRecipients.length,
        sentCount,
        failedCount,
      },
      results: sendResults,
    });
  } catch (error) {
    console.log("Error sending reminder emails:", error);
    return res.status(500).json({ message: "No se pudo enviar el recordatorio." });
  }
};

module.exports = {
  sendTestEmailByAdmin,
  sendReminderEmailByAdmin,
};

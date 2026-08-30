const axios = require("axios");

const WHATSAPP_API_BASE_URL = "https://graph.facebook.com";

function buildConfigError(message) {
  return new Error(`WHATSAPP_CONFIG_INVALID: ${message}`);
}

function normalizeEnvString(value) {
  return String(value ?? "").trim();
}

function normalizePhoneNumber(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  const normalized = raw.startsWith("+")
    ? `+${raw.slice(1).replace(/\D/g, "")}`
    : raw.replace(/\D/g, "");

  return normalized;
}

function buildConfig() {
  const accessToken = normalizeEnvString(process.env.WHATSAPP_ACCESS_TOKEN);
  const phoneNumberId = normalizeEnvString(process.env.WHATSAPP_PHONE_NUMBER_ID);
  const apiVersion = normalizeEnvString(process.env.WHATSAPP_API_VERSION || "v21.0");
  const timeoutMs = Number(normalizeEnvString(process.env.WHATSAPP_TIMEOUT_MS || "15000"));

  if (!accessToken) {
    throw buildConfigError("WHATSAPP_ACCESS_TOKEN es obligatorio.");
  }

  if (!phoneNumberId) {
    throw buildConfigError("WHATSAPP_PHONE_NUMBER_ID es obligatorio.");
  }

  return {
    accessToken,
    phoneNumberId,
    apiVersion,
    timeoutMs,
  };
}

function buildTemplatePayload({ templateName, templateLanguageCode, templateParams = [] }) {
  const normalizedTemplateName = String(templateName || "").trim();
  if (!normalizedTemplateName) {
    return null;
  }

  const normalizedLanguageCode = String(templateLanguageCode || "es").trim() || "es";
  const bodyParams = Array.isArray(templateParams)
    ? templateParams
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
      .map((value) => ({
        type: "text",
        text: value,
      }))
    : [];

  const template = {
    name: normalizedTemplateName,
    language: { code: normalizedLanguageCode },
  };

  if (bodyParams.length > 0) {
    template.components = [
      {
        type: "body",
        parameters: bodyParams,
      },
    ];
  }

  return template;
}

async function sendWhatsAppNotification({ to, text, templateName, templateLanguageCode, templateParams }) {
  const logOnly = normalizeEnvString(process.env.WHATSAPP_LOG_ONLY || "false").toLowerCase() === "true";
  const normalizedTo = normalizePhoneNumber(to);

  if (!normalizedTo) {
    throw buildConfigError("Numero destinatario invalido. Usa formato internacional, por ejemplo 573001112233.");
  }

  const template = buildTemplatePayload({
    templateName,
    templateLanguageCode,
    templateParams,
  });

  const messageText = String(text || "").trim();

  if (!template && !messageText) {
    throw buildConfigError("Debes indicar 'text' o un 'templateName' valido.");
  }

  if (logOnly) {
    console.log("[whatsapp] log-only notification", {
      to: normalizedTo,
      hasTemplate: Boolean(template),
      previewText: messageText,
    });
    return;
  }

  const config = buildConfig();
  const url = `${WHATSAPP_API_BASE_URL}/${config.apiVersion}/${config.phoneNumberId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalizedTo,
  };

  if (template) {
    payload.type = "template";
    payload.template = template;
  } else {
    payload.type = "text";
    payload.text = {
      preview_url: false,
      body: messageText,
    };
  }

  try {
    await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      timeout: config.timeoutMs,
    });
  } catch (error) {
    if (error?.code === "ECONNABORTED") {
      throw new Error(`WHATSAPP_TIMEOUT: ${error.message}`);
    }

    const providerMessage = error?.response?.data
      ? JSON.stringify(error.response.data)
      : error?.message;

    throw new Error(`WHATSAPP_SEND_FAILED: ${providerMessage}`);
  }
}

module.exports = {
  sendWhatsAppNotification,
  normalizePhoneNumber,
};

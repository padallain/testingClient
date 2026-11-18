const mongoose = require("mongoose");
const DailyCheck = require("../models/dailyCheck.model");
const User = require("../models/user.model");
const { sendEmail } = require("./sendEmail");
const DAILY_CHECK_TIMEZONE = process.env.DAILY_CHECK_TIMEZONE || "America/Caracas";

function buildDatabaseUnavailableResult(extra = {}) {
  return {
    sent: false,
    reason: "db_unavailable",
    message: "No se pudo consultar la base de datos para armar el reporte.",
    error: "Database unavailable",
    pendingDrivers: [],
    drivers: [],
    recipients: [],
    results: [],
    ...extra,
  };
}

function normalizeDriverLabel(value) {
  return String(value || "").trim().toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}

function buildDailyCheckReportContent(driverStatuses) {
  const text = driverStatuses.map(driver => {
    const status = driver.status === "reporte ok" ? "Reporte OK" : "Pendiente";
    const checks = driver.reports?.length
      ? driver.reports.map(report => [
        `  Vehiculo: ${report.placa || "Sin placa"} - ${report.modelo || "Modelo no indicado"} ${report.anio || ""}`.trimEnd(),
        `  Personal/ayudante: ${report.personalTrabajo || "No indicado"}`,
        ...(report.destino ? [`  Destino: ${report.destino}`] : []),
      ].join("\n"))
      : ["  Sin chequeo registrado para este dia."];
    return [`${driver.displayName} - ${status}`, ...checks].join("\n");
  }).join("\n\n");

  const html = `<ul>${driverStatuses.map(driver => {
    const status = driver.status === "reporte ok" ? "Reporte OK" : "Pendiente";
    const checks = driver.reports?.length
      ? `<ul>${driver.reports.map(report => `<li><strong>Vehiculo:</strong> ${escapeHtml(report.placa || "Sin placa")} - ${escapeHtml(report.modelo || "Modelo no indicado")} ${escapeHtml(report.anio || "")}<br><strong>Personal/ayudante:</strong> ${escapeHtml(report.personalTrabajo || "No indicado")}${report.destino ? `<br><strong>Destino:</strong> ${escapeHtml(report.destino)}` : ""}</li>`).join("")}</ul>`
      : "<ul><li>Sin chequeo registrado para este dia.</li></ul>";
    return `<li><strong>${escapeHtml(driver.displayName)}: ${status}</strong>${checks}</li>`;
  }).join("")}</ul>`;

  return { text, html };
}

function getZonedDateParts(date, timeZone = DAILY_CHECK_TIMEZONE) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).filter((part) => part.type !== "literal").map(({ type, value }) => [type, Number(value)]));
}

function formatLocalDateKey(date, timeZone = DAILY_CHECK_TIMEZONE) {
  const { year, month, day } = getZonedDateParts(date, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getDateReferenceForLocalDate(dateKey, timeZone = DAILY_CHECK_TIMEZONE) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey));
  if (!match) throw new Error("La fecha debe tener formato YYYY-MM-DD.");
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const normalized = new Date(Date.UTC(year, month - 1, day));
  if (normalized.getUTCFullYear() !== year || normalized.getUTCMonth() + 1 !== month || normalized.getUTCDate() !== day) {
    throw new Error("La fecha indicada no existe.");
  }
  return new Date(getZonedMidnightUtc(year, month, day, timeZone).getTime() + 12 * 60 * 60 * 1000);
}

function getZonedMidnightUtc(year, month, day, timeZone) {
  const localMidnightAsUtc = Date.UTC(year, month - 1, day);
  let timestamp = localMidnightAsUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = getZonedDateParts(new Date(timestamp), timeZone);
    const representedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    timestamp = localMidnightAsUtc - (representedAsUtc - timestamp);
  }
  return new Date(timestamp);
}

function getTodayDayRange(referenceDate = new Date(), timeZone = DAILY_CHECK_TIMEZONE) {
  const { year, month, day } = getZonedDateParts(referenceDate, timeZone);
  const start = getZonedMidnightUtc(year, month, day, timeZone);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  const end = new Date(getZonedMidnightUtc(nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate(), timeZone).getTime() - 1);

  return { start, end };
}

async function getAdminRecipients() {
  if (mongoose.connection.readyState !== 1) {
    throw new Error("DATABASE_UNAVAILABLE");
  }

  const admins = await User.find({
    role: "admin",
    email: { $exists: true, $ne: "" },
  })
    .select("email")
    .lean();

  return [...new Set(admins
    .map((admin) => String(admin?.email || "").trim().toLowerCase())
    .filter(Boolean))];
}

async function getMissingDailyCheckDriversForToday(referenceDate = new Date()) {
  const { start, end } = getTodayDayRange(referenceDate);

  const [drivers, todaysReports] = await Promise.all([
    User.find({
      role: "chofer",
      email: { $exists: true, $ne: "" },
    })
      .select("username email")
      .lean(),
    DailyCheck.find({
      fechaHoraRegistro: { $gte: start, $lte: end },
    })
      .select("chofer")
      .lean(),
  ]);

  const reportedDrivers = new Set(
    todaysReports
      .map((report) => normalizeDriverLabel(report?.chofer))
      .filter(Boolean),
  );

  const missingDrivers = drivers.filter((driver) => {
    const candidateNames = [
      driver?.username,
      driver?.email,
      String(driver?.email || "").split("@")[0],
    ]
      .map((value) => normalizeDriverLabel(value))
      .filter(Boolean);

    return !candidateNames.some((name) => reportedDrivers.has(name));
  });

  return missingDrivers
    .map((driver) => ({
      username: String(driver?.username || "").trim(),
      email: String(driver?.email || "").trim(),
    }))
    .filter((driver) => driver.username || driver.email);
}

async function getDriversDailyCheckStatusForToday(referenceDate = new Date()) {
  if (mongoose.connection.readyState !== 1) {
    throw new Error("DATABASE_UNAVAILABLE");
  }

  const { start, end } = getTodayDayRange(referenceDate);

  const [drivers, todaysReports] = await Promise.all([
    User.find({
      role: "chofer",
      email: { $exists: true, $ne: "" },
    })
      .select("username email")
      .lean(),
    DailyCheck.find({
      fechaHoraRegistro: { $gte: start, $lte: end },
    })
      .select("chofer placa modelo anio personalTrabajo destino fechaHoraRegistro")
      .lean(),
  ]);

  const reportedDrivers = new Set(
    todaysReports
      .map((report) => normalizeDriverLabel(report?.chofer))
      .filter(Boolean),
  );

  return drivers
    .map((driver) => {
      const username = String(driver?.username || "").trim();
      const email = String(driver?.email || "").trim();
      const baseLabel = username || email || "Sin nombre";
      const candidateNames = [
        username,
        email,
        String(email || "").split("@")[0],
      ]
        .map((value) => normalizeDriverLabel(value))
        .filter(Boolean);

      const hasReport = candidateNames.some((name) => reportedDrivers.has(name));
      const reports = todaysReports
        .filter(report => candidateNames.includes(normalizeDriverLabel(report?.chofer)))
        .map(report => ({
          placa: String(report?.placa || "").trim(),
          modelo: String(report?.modelo || "").trim(),
          anio: report?.anio,
          personalTrabajo: String(report?.personalTrabajo || "").trim(),
          destino: String(report?.destino || "").trim(),
          fechaHoraRegistro: report?.fechaHoraRegistro,
        }));

      return {
        username,
        email,
        status: hasReport ? "reporte ok" : "pendiente",
        displayName: baseLabel,
        reports,
      };
    })
    .filter((driver) => driver.username || driver.email);
}

async function sendMorningAdminReminderEmail() {
  try {
    const adminRecipients = await getAdminRecipients();

    if (!adminRecipients.length) {
      return {
        sent: false,
        reason: "no_admin_recipients",
      };
    }

    const subject = "Recordatorio matutino: chequeo diario de operacion";
    const text = [
      "Recordatorio MakeRoute",
      "",
      "Buenos dias. Completa el chequeo diario de choferes antes del reporte de las 10:00.",
      "",
      "A las 10:00 se enviara el reporte del estado del chequeo diario a los administradores.",
      "",
      "Este mensaje fue enviado automaticamente por MakeRoute.",
    ].join("\n");

    const html = `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
        <h2 style="margin-bottom: 10px;">Recordatorio matutino MakeRoute</h2>
        <p>Buenos dias. Completa el chequeo diario de choferes antes del reporte de las 10:00.</p>
        <p>A las 10:00 se enviara el reporte del estado del chequeo diario a los administradores.</p>
        <p style="margin-top: 16px; color: #4b5563; font-size: 12px;">Este mensaje fue enviado automaticamente por MakeRoute.</p>
      </div>
    `;

    const results = [];

    for (const recipient of adminRecipients) {
      try {
        await sendEmail({ to: recipient, subject, text, html });
        results.push({ recipient, status: "sent" });
      } catch (error) {
        console.error("[dailyCheckReminder] Error sending morning admin email:", error);
        results.push({ recipient, status: "failed", error: String(error?.message || error) });
      }
    }

    return {
      sent: results.some((result) => result.status === "sent"),
      recipients: adminRecipients,
      results,
    };
  } catch (error) {
    console.error("[dailyCheckReminder] Unable to send morning reminder:", error);
    return buildDatabaseUnavailableResult({
      message: "No se pudo consultar la base de datos para enviar el recordatorio matutino.",
      error: String(error?.message || error),
    });
  }
}

async function sendMissingDailyCheckReminderEmail(referenceDate = new Date()) {
  try {
    const driverStatuses = await getDriversDailyCheckStatusForToday(referenceDate);
    const missingDrivers = driverStatuses.filter((driver) => driver.status === "pendiente");

    const adminRecipients = await getAdminRecipients();

    if (!adminRecipients.length) {
      return {
        sent: false,
        reason: "no_admin_recipients",
        missingDrivers: missingDrivers.map((driver) => driver.displayName),
        drivers: driverStatuses,
      };
    }

    const subject = "Reporte diario: chequeo de camiones";
    const reportContent = buildDailyCheckReportContent(driverStatuses);

    const text = [
      "Reporte diario MakeRoute",
      "",
      `Fecha: ${referenceDate.toLocaleDateString("es-ES", { timeZone: DAILY_CHECK_TIMEZONE })}`,
      "",
      `Choferes con reporte: ${driverStatuses.filter((driver) => driver.status === "reporte ok").length}/${driverStatuses.length}`,
      "",
      `Choferes pendientes: ${missingDrivers.length}`,
      "",
      missingDrivers.length
        ? `Pendientes: ${missingDrivers.map((driver) => driver.displayName).join(", ")}`
        : "Todos los choferes registraron el chequeo diario.",
      "",
      "Detalle completo:",
      reportContent.text,
      "",
      "Este mensaje fue enviado automaticamente por MakeRoute.",
    ].join("\n");

    const html = `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
        <h2 style="margin-bottom: 10px;">Reporte diario MakeRoute</h2>
        <p><strong>Fecha:</strong> ${referenceDate.toLocaleDateString("es-ES", { timeZone: DAILY_CHECK_TIMEZONE })}</p>
        <p><strong>Choferes con reporte:</strong> ${driverStatuses.filter((driver) => driver.status === "reporte ok").length}/${driverStatuses.length}</p>
        <p><strong>Choferes pendientes:</strong> ${missingDrivers.length}</p>
        <p style="margin: 12px 0 8px;"><strong>Detalle:</strong></p>
        ${reportContent.html}
        <p style="margin-top: 16px; color: #4b5563; font-size: 12px;">Este mensaje fue enviado automaticamente por MakeRoute.</p>
      </div>
    `;

    const results = [];

    for (const recipient of adminRecipients) {
      try {
        await sendEmail({
          to: recipient,
          subject,
          text,
          html,
        });

        results.push({ recipient, status: "sent" });
      } catch (error) {
        console.error("[dailyCheckReminder] Error sending daily report email:", error);
        results.push({ recipient, status: "failed", error: String(error?.message || error) });
      }
    }

    return {
      sent: results.some((result) => result.status === "sent"),
      pendingDrivers: missingDrivers.map((driver) => driver.displayName),
      drivers: driverStatuses,
      recipients: adminRecipients,
      results,
    };
  } catch (error) {
    console.error("[dailyCheckReminder] Unable to build daily report:", error);
    return buildDatabaseUnavailableResult({
      message: "No se pudo consultar la base de datos para enviar el reporte diario.",
      error: String(error?.message || error),
    });
  }
}

let reminderScheduler = null;
let lastMorningTriggerDateKey = null;

function startDailyCheckReminderScheduler() {
  if (reminderScheduler) {
    return reminderScheduler;
  }

  reminderScheduler = setInterval(async () => {
    const now = new Date();
    const currentDateKey = formatLocalDateKey(now);
    const currentTime = getZonedDateParts(now);

    if (currentTime.hour === 8 && currentTime.minute === 0 && lastMorningTriggerDateKey !== currentDateKey) {
      lastMorningTriggerDateKey = currentDateKey;

      try {
        const result = await sendMorningAdminReminderEmail();
        console.log("[dailyCheckReminder] Morning admin reminder finished:", result);
      } catch (error) {
        console.error("[dailyCheckReminder] Morning admin reminder failed:", error);
      }
    }

  }, 60 * 1000);

  console.log(`[dailyCheckReminder] Morning reminder scheduler started at 08:00 (${DAILY_CHECK_TIMEZONE}).`);

  return reminderScheduler;
}

module.exports = {
  getAdminRecipients,
  getZonedDateParts,
  formatLocalDateKey,
  getDateReferenceForLocalDate,
  buildDailyCheckReportContent,
  getTodayDayRange,
  getMissingDailyCheckDriversForToday,
  getDriversDailyCheckStatusForToday,
  sendMorningAdminReminderEmail,
  sendMissingDailyCheckReminderEmail,
  startDailyCheckReminderScheduler,
};

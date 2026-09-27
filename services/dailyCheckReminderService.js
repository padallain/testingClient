const mongoose = require("mongoose");
const DailyCheck = require("../models/dailyCheck.model");
const User = require("../models/user.model");
const { sendEmail } = require("./sendEmail");

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

function formatLocalDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getTodayDayRange(referenceDate = new Date()) {
  const start = new Date(referenceDate);
  start.setHours(0, 0, 0, 0);

  const end = new Date(referenceDate);
  end.setHours(23, 59, 59, 999);

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

async function getMissingDailyCheckDriversForToday() {
  const { start, end } = getTodayDayRange();

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

async function getDriversDailyCheckStatusForToday() {
  if (mongoose.connection.readyState !== 1) {
    throw new Error("DATABASE_UNAVAILABLE");
  }

  const { start, end } = getTodayDayRange();

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

      return {
        username,
        email,
        status: hasReport ? "reporte ok" : "pendiente",
        displayName: baseLabel,
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
      "Buenos dias. Hoy se requiere cerrar el chequeo diario de choferes antes del mediodia.",
      "",
      "A las 12:00 se enviara el resumen del estado del chequeo diario a los administradores.",
      "",
      "Este mensaje fue enviado automaticamente por MakeRoute.",
    ].join("\n");

    const html = `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
        <h2 style="margin-bottom: 10px;">Recordatorio matutino MakeRoute</h2>
        <p>Buenos dias. Hoy se requiere cerrar el chequeo diario de choferes antes del mediodia.</p>
        <p>A las 12:00 se enviara el resumen del estado del chequeo diario a los administradores.</p>
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

async function sendMissingDailyCheckReminderEmail() {
  try {
    const driverStatuses = await getDriversDailyCheckStatusForToday();
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
    const driverRows = driverStatuses
      .map((driver) => `${driver.displayName} - ${driver.status === "reporte ok" ? "Reporte OK" : "Pendiente"}`)
      .join("\n");

    const text = [
      "Reporte diario MakeRoute",
      "",
      `Fecha: ${new Date().toLocaleDateString("es-ES")}`,
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
      driverRows,
      "",
      "Este mensaje fue enviado automaticamente por MakeRoute.",
    ].join("\n");

    const html = `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
        <h2 style="margin-bottom: 10px;">Reporte diario MakeRoute</h2>
        <p><strong>Fecha:</strong> ${new Date().toLocaleDateString("es-ES")}</p>
        <p><strong>Choferes con reporte:</strong> ${driverStatuses.filter((driver) => driver.status === "reporte ok").length}/${driverStatuses.length}</p>
        <p><strong>Choferes pendientes:</strong> ${missingDrivers.length}</p>
        <p style="margin: 12px 0 8px;"><strong>Detalle:</strong></p>
        <ul>
          ${driverStatuses
            .map((driver) => `<li>${driver.displayName}: <strong>${driver.status === "reporte ok" ? "Reporte OK" : "Pendiente"}</strong></li>`)
            .join("")}
        </ul>
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
let lastNoonTriggerDateKey = null;

function startDailyCheckReminderScheduler() {
  if (reminderScheduler) {
    return reminderScheduler;
  }

  reminderScheduler = setInterval(async () => {
    const now = new Date();
    const currentDateKey = formatLocalDateKey(now);

    if (now.getHours() === 8 && now.getMinutes() === 0 && lastMorningTriggerDateKey !== currentDateKey) {
      lastMorningTriggerDateKey = currentDateKey;

      try {
        const result = await sendMorningAdminReminderEmail();
        console.log("[dailyCheckReminder] Morning admin reminder finished:", result);
      } catch (error) {
        console.error("[dailyCheckReminder] Morning admin reminder failed:", error);
      }
    }

    if (now.getHours() === 12 && now.getMinutes() === 0 && lastNoonTriggerDateKey !== currentDateKey) {
      lastNoonTriggerDateKey = currentDateKey;

      try {
        const result = await sendMissingDailyCheckReminderEmail();
        console.log("[dailyCheckReminder] Noon daily status report finished:", result);
      } catch (error) {
        console.error("[dailyCheckReminder] Noon daily status report failed:", error);
      }
    }
  }, 60 * 1000);

  console.log("[dailyCheckReminder] Scheduler started at 08:00 and 12:00 local time.");

  return reminderScheduler;
}

module.exports = {
  getAdminRecipients,
  getMissingDailyCheckDriversForToday,
  getDriversDailyCheckStatusForToday,
  sendMorningAdminReminderEmail,
  sendMissingDailyCheckReminderEmail,
  startDailyCheckReminderScheduler,
};

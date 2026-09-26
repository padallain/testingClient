const DailyCheck = require("../models/dailyCheck.model");
const User = require("../models/user.model");
const { sendEmail } = require("./sendEmail");

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

async function sendMissingDailyCheckReminderEmail() {
  const missingDrivers = await getMissingDailyCheckDriversForToday();

  if (!missingDrivers.length) {
    return {
      sent: false,
      reason: "no_missing_drivers",
    };
  }

  const adminRecipients = await getAdminRecipients();

  if (!adminRecipients.length) {
    return {
      sent: false,
      reason: "no_admin_recipients",
      missingDrivers: missingDrivers.map((driver) => driver.username || driver.email),
    };
  }

  const driverNames = missingDrivers
    .map((driver) => driver.username || driver.email)
    .join(", ");

  const subject = "Recordatorio: choferes sin reporte del chequeo diario";
  const text = [
    "Recordatorio MakeRoute",
    "",
    `Los siguientes choferes no registraron el chequeo diario de hoy: ${driverNames}.`,
    "",
    "Por favor revisa el sistema y solicita el reporte pendiente lo antes posible.",
    "",
    "Este mensaje fue enviado automaticamente por MakeRoute.",
  ].join("\n");

  const html = `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
      <h2 style="margin-bottom: 10px;">Recordatorio MakeRoute</h2>
      <p>Los siguientes choferes no registraron el chequeo diario de hoy:</p>
      <p><strong>${driverNames}</strong></p>
      <p>Por favor revisa el sistema y solicita el reporte pendiente lo antes posible.</p>
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
      console.error("[dailyCheckReminder] Error sending admin reminder email:", error);
      results.push({ recipient, status: "failed", error: String(error?.message || error) });
    }
  }

  return {
    sent: results.some((result) => result.status === "sent"),
    missingDrivers: missingDrivers.map((driver) => driver.username || driver.email),
    recipients: adminRecipients,
    results,
  };
}

let reminderScheduler = null;
let lastTriggeredDateKey = null;

function startDailyCheckReminderScheduler() {
  if (reminderScheduler) {
    return reminderScheduler;
  }

  reminderScheduler = setInterval(async () => {
    const now = new Date();
    const currentDateKey = formatLocalDateKey(now);

    if (now.getHours() !== 12 || now.getMinutes() !== 0) {
      return;
    }

    if (lastTriggeredDateKey === currentDateKey) {
      return;
    }

    lastTriggeredDateKey = currentDateKey;

    try {
      const result = await sendMissingDailyCheckReminderEmail();
      console.log("[dailyCheckReminder] Scheduled check finished:", result);
    } catch (error) {
      console.error("[dailyCheckReminder] Scheduled check failed:", error);
    }
  }, 60 * 1000);

  console.log("[dailyCheckReminder] Scheduler started at 12:00 local time.");

  return reminderScheduler;
}

module.exports = {
  getAdminRecipients,
  getMissingDailyCheckDriversForToday,
  sendMissingDailyCheckReminderEmail,
  startDailyCheckReminderScheduler,
};

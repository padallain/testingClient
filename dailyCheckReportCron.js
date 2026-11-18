require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const mongoose = require("mongoose");
const { connectToDatabase } = require("./db");
const { sendMissingDailyCheckReminderEmail } = require("./services/dailyCheckReminderService");

(async () => {
  let exitCode = 0;
  try {
    await connectToDatabase();
    const result = await sendMissingDailyCheckReminderEmail();
    const failedRecipients = result.results?.filter(item => item.status !== "sent").length || 0;
    console.log("[dailyCheckCron] Daily report completed", JSON.stringify({
      sent: result.sent,
      recipients: result.recipients?.length || 0,
      drivers: result.drivers?.length || 0,
      pendingDrivers: result.pendingDrivers?.length || 0,
      failedRecipients,
      reason: result.reason || null,
    }));
    if (!result.sent || failedRecipients > 0) exitCode = 1;
  } catch (error) {
    console.error("[dailyCheckCron] Daily report failed:", error.message);
    exitCode = 1;
  } finally {
    await mongoose.disconnect();
    process.exitCode = exitCode;
  }
})();
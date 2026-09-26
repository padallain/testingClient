require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { sendMissingDailyCheckReminderEmail } = require('./services/dailyCheckReminderService');

(async () => {
  try {
    const result = await sendMissingDailyCheckReminderEmail();
    console.log('REMINDER_RESULT', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('REMINDER_ERROR');
    console.error(error && error.message ? error.message : error);
    process.exitCode = 1;
  }
})();

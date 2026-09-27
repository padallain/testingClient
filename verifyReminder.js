require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { sendMissingDailyCheckReminderEmail } = require('./services/dailyCheckReminderService');

(async () => {
  try {
    const result = await sendMissingDailyCheckReminderEmail();
    console.log('RESULT_JSON');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('UNEXPECTED_ERROR');
    console.error(error && error.message ? error.message : error);
    process.exit(1);
  }
})();

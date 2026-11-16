require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { getDateReferenceForLocalDate, sendMissingDailyCheckReminderEmail } = require('./services/dailyCheckReminderService');

(async () => {
  try {
    const dateArgument = process.argv[2];
    const referenceDate = dateArgument ? getDateReferenceForLocalDate(dateArgument) : new Date();
    const result = await sendMissingDailyCheckReminderEmail(referenceDate);
    console.log('REMINDER_RESULT', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('REMINDER_ERROR');
    console.error(error && error.message ? error.message : error);
    process.exitCode = 1;
  }
})();

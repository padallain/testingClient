require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mongoose = require('mongoose');
const { connectToDatabase } = require('./db');
const { getDateReferenceForLocalDate, sendMissingDailyCheckReminderEmail } = require('./services/dailyCheckReminderService');

(async () => {
  try {
    await connectToDatabase();
    const dateArgument = process.argv[2];
    const referenceDate = dateArgument ? getDateReferenceForLocalDate(dateArgument) : new Date();
    const result = await sendMissingDailyCheckReminderEmail(referenceDate);
    console.log('REMINDER_RESULT', JSON.stringify(result, null, 2));
    if (!result.sent) process.exitCode = 1;
  } catch (error) {
    console.error('REMINDER_ERROR');
    console.error(error && error.message ? error.message : error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();

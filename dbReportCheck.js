require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mongoose = require('mongoose');
const User = require('./models/user.model');
const DailyCheck = require('./models/dailyCheck.model');

(async () => {
  try {
    const dbUri = process.env.DB_URI || process.env.MONGODB_URI;
    if (!dbUri) {
      console.log('NO_DB_URI');
      process.exit(1);
    }

    await mongoose.connect(dbUri, { serverSelectionTimeoutMS: 20000 });
    const now = new Date();

    const start = new Date(now);
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);

    const end = new Date(now);
    end.setDate(end.getDate() - 1);
    end.setHours(23, 59, 59, 999);

    const [drivers, reports] = await Promise.all([
      User.find({ role: 'chofer' }).select('username email').lean(),
      DailyCheck.find({ fechaHoraRegistro: { $gte: start, $lte: end } }).select('chofer placa fechaHoraRegistro').lean(),
    ]);

    console.log('DB_CONNECTED');
    console.log('TOTAL_DRIVERS', drivers.length);
    console.log('TOTAL_REPORTS', reports.length);
    console.log('REPORTS_JSON', JSON.stringify(reports.map((r) => ({
      chofer: r.chofer,
      placa: r.placa,
      fechaHoraRegistro: r.fechaHoraRegistro,
    })), null, 2));

    const reported = new Set(reports.map((r) => String(r.chofer).trim().toLowerCase()));
    const missing = drivers.filter((d) => {
      const labels = [d.username, d.email, String((d.email || '').split('@')[0])]
        .map((v) => String(v || '').trim().toLowerCase())
        .filter(Boolean);
      return !labels.some((label) => reported.has(label));
    });

    console.log('MISSING_JSON', JSON.stringify(missing.map((d) => ({
      username: d.username,
      email: d.email,
    })), null, 2));

    await mongoose.disconnect();
  } catch (err) {
    console.error('DB_ERROR');
    console.error(err && err.message ? err.message : err);
    process.exitCode = 1;
  }
})();

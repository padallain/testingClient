const Company = require('../models/dispatchCompany.model');
const Settings = require('../models/dispatchCompanySettings.model');

async function loadDispatchCompanies() {
  const [companies, settings] = await Promise.all([
    Company.find({}).sort({ name: 1 }).lean(), Settings.findById('default').lean(),
  ]);
  return { companies, defaultCompanyId: settings?.defaultCompanyId ? String(settings.defaultCompanyId) : '' };
}

module.exports = { loadDispatchCompanies };
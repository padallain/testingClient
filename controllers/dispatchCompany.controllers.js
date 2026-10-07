const mongoose = require('mongoose');
const Company = require('../models/dispatchCompany.model');
const Settings = require('../models/dispatchCompanySettings.model');
const { loadDispatchCompanies } = require('../services/dispatchCompany.service');

const handler = action => async (req, res) => {
  try { await action(req, res); }
  catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'Ya existe una empresa con ese nombre.' });
    console.error('[dispatch-companies]', error.message);
    res.status(500).json({ message: 'No se pudo guardar o consultar las empresas de despacho.' });
  }
};

exports.listCompanies = handler(async (_req, res) => res.json(await loadDispatchCompanies()));
exports.createCompany = handler(async (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.normalize('NFC').trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > 140) return res.status(400).json({ message: 'Ingresa un nombre de empresa de hasta 140 caracteres.' });
  const company = await Company.create({ name, normalizedName: name.toLocaleLowerCase('es') });
  if (req.body.makeDefault === true) {
    await Settings.findByIdAndUpdate('default', { $set: { defaultCompanyId: company._id } }, { upsert: true, new: true });
  } else {
    await Settings.findByIdAndUpdate('default', { $setOnInsert: { defaultCompanyId: company._id } }, { upsert: true, new: true });
  }
  res.status(201).json({ ...(await loadDispatchCompanies()), company: company.toObject() });
});
exports.setDefaultCompany = handler(async (req, res) => {
  const id = req.body.companyId;
  if (typeof id !== 'string' || !mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'Selecciona una empresa registrada.' });
  const company = await Company.findById(id).lean();
  if (!company) return res.status(404).json({ message: 'Empresa no encontrada.' });
  await Settings.findByIdAndUpdate('default', { $set: { defaultCompanyId: company._id } }, { upsert: true, new: true });
  res.json(await loadDispatchCompanies());
});
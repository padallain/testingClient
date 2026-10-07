const express = require('express');
const { requireAdminRole } = require('../controllers/auth.controllers');
const controller = require('../controllers/dispatchCompany.controllers');
const router = express.Router();

router.use(requireAdminRole);
router.get('/', controller.listCompanies);
router.post('/', controller.createCompany);
router.put('/default', controller.setDefaultCompany);

module.exports = router;
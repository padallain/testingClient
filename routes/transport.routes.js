const express = require('express');
const { requireAdminRole } = require('../controllers/auth.controllers');
const controller = require('../controllers/transport.controllers');
const router = express.Router();

router.use(requireAdminRole);
router.get('/configuration', controller.getConfiguration);
router.put('/configuration', controller.updateConfiguration);
router.patch('/trips/:routeId', controller.saveTrip);
router.get('/routes-to-finish', controller.listRoutesToFinish);
router.post('/trips/:routeId/finish', controller.finishRoute);
router.get('/trips/:routeId/export', controller.exportTrip);
router.get('/guides/:routeId', controller.getGuideKpis);
router.get('/guides', controller.listKpis);
router.get('/aggregates', controller.getAggregates);
router.get('/comparison', controller.getComparisons);
router.post('/planning', controller.planTrip);
router.get('/weekly.xlsx', controller.exportWeekly);

module.exports = router;
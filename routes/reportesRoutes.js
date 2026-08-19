// routes/reportesRoutes.js
// Panel de estadísticas: exclusivo del super admin.
const express = require('express');
const router  = express.Router();
const { authenticateToken } = require('../middleware/auth');
const requirePermiso        = require('../middleware/requirePermiso');
const ReportesController    = require('../controllers/reportesController');

const soloAdmin = [authenticateToken, requirePermiso('reportes.ver')];

// Los tres aceptan ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD.
// Sin parámetros, el mes actual.
router.get('/reportes/resumen', soloAdmin, ReportesController.resumen);
router.get('/reportes/pdf',     soloAdmin, ReportesController.pdf);
router.get('/reportes/csv',     soloAdmin, ReportesController.csv);

module.exports = router;
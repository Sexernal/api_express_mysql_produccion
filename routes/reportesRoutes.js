// routes/reportesRoutes.js
const express = require('express');
const router  = express.Router();
const { authenticateToken } = require('../middleware/auth');
const requireAdmin          = require('../middleware/requireAdmin');
const requirePermiso           = require('../middleware/requirePermiso');
const ReportesController    = require('../controllers/reportesController');

// SOLO veterinarios (admin) — un recepcionista o propietario recibe 403
router.get('/reportes/resumen', authenticateToken, requirePermiso('reportes.ver'), ReportesController.resumen);

module.exports = router;
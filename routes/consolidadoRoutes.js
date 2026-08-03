// routes/consolidadoRoutes.js
const express = require('express');
const router  = express.Router();
const { authenticateToken } = require('../middleware/auth');
const requireAdmin           = require('../middleware/requireAdmin');
const ConsolidadoController  = require('../controllers/consolidadoController');

// SOLO veterinarios (admin) — es el informe profesional para el Colegio de Veterinarios.
// Si más adelante quieres que las recepcionistas también puedan verlo, cambia
// requireAdmin por authorizeRoles(['admin', 'user']) (importándolo desde middleware/auth).
router.get('/consolidado', authenticateToken, requireAdmin, ConsolidadoController.porFecha);

module.exports = router;
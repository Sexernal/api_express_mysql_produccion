// routes/consolidadoRoutes.js
const express = require('express');
const router  = express.Router();
const { authenticateToken } = require('../middleware/auth');
const requirePermiso         = require('../middleware/requirePermiso');
const ConsolidadoController  = require('../controllers/consolidadoController');

// Informe profesional para el Colegio de Veterinarios: lo ven el super admin
// y los veterinarios, no recepción. El permiso 'consolidado.ver' define quién,
// en services/permisos.js.
const puedeVerlo = [authenticateToken, requirePermiso('consolidado.ver')];

router.get('/consolidado',     puedeVerlo, ConsolidadoController.porFecha);
// Mismo informe, pero como archivo descargable
router.get('/consolidado/pdf', puedeVerlo, ConsolidadoController.pdf);

module.exports = router;

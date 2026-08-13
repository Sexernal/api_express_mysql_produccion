// routes/notificacionesRoutes.js
const express = require('express');
const router  = express.Router();
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const NotificacionesController = require('../controllers/notificacionesController');

// Solo personal de la clínica (veterinarios y recepcionistas), no propietarios
router.get('/notificaciones', authenticateToken, authorizeRoles(['superadmin', 'admin', 'user']), NotificacionesController.list);

module.exports = router;
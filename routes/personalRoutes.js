// routes/personalRoutes.js
// Gestión del personal de la clínica. Todo exige 'usuarios.gestionar',
// que solo tiene el super admin.
const express = require('express');
const router  = express.Router();
const { authenticateToken } = require('../middleware/auth');
const requirePermiso        = require('../middleware/requirePermiso');
const PersonalController    = require('../controllers/personalController');

const soloAdmin = [authenticateToken, requirePermiso('usuarios.gestionar')];

// /roles va ANTES de /:id para que no lo capture como si fuera un id
router.get('/personal/roles',        soloAdmin, PersonalController.rolesDisponibles);
router.get('/personal',              soloAdmin, PersonalController.list);
router.get('/personal/:id/historial', soloAdmin, PersonalController.historial);

// El cambio de rol pide además la contraseña del propio administrador,
// eso se valida dentro del controlador.
router.put('/personal/:id/rol',      soloAdmin, PersonalController.cambiarRol);
router.put('/personal/:id',          soloAdmin, PersonalController.actualizarDatos);

module.exports = router;

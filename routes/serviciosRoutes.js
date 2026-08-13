// routes/serviciosRoutes.js
const express = require('express');
const router  = express.Router();
const { authenticateToken } = require('../middleware/auth');
const requireAdmin           = require('../middleware/requireAdmin');
const requirePermiso           = require('../middleware/requirePermiso');
const ServiciosController    = require('../controllers/serviciosController');

router.get('/',       authenticateToken,             ServiciosController.list);
router.post('/',      authenticateToken, requirePermiso('servicios.gestionar'), ServiciosController.create);
router.put('/:id',    authenticateToken, requirePermiso('servicios.gestionar'), ServiciosController.update);
router.delete('/:id', authenticateToken, requirePermiso('servicios.gestionar'), ServiciosController.remove);

module.exports = router;
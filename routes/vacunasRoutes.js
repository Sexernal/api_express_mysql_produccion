// routes/vacunasRoutes.js
const express = require('express');
const router  = express.Router();
const { authenticateToken } = require('../middleware/auth');
const requireAdmin           = require('../middleware/requireAdmin');
const VacunasController      = require('../controllers/vacunasController');

// IMPORTANTE: /proximas va ANTES de /:id para que no lo capture como id
router.get('/vacunas/proximas', authenticateToken, requireAdmin, VacunasController.proximas);
router.get('/vacunas',          authenticateToken,               VacunasController.listByPet);
router.get('/vacunas/:id',      authenticateToken,               VacunasController.getById);
router.post('/vacunas',         authenticateToken, requireAdmin, VacunasController.create);
router.post('/vacunas/:id/aplicar',  authenticateToken, requireAdmin, VacunasController.aplicar);
router.put('/vacunas/:id',      authenticateToken, requireAdmin, VacunasController.update);
router.delete('/vacunas/:id',   authenticateToken, requireAdmin, VacunasController.remove);

module.exports = router;
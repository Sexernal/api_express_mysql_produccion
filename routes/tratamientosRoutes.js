// routes/tratamientosRoutes.js
const express = require('express');
const router  = express.Router();
const { authenticateToken }   = require('../middleware/auth');
const requireAdmin            = require('../middleware/requireAdmin');
const TratamientosController  = require('../controllers/tratamientosController');

router.get('/tratamientos',      authenticateToken,               TratamientosController.listByPet);
router.get('/tratamientos/:id',  authenticateToken,               TratamientosController.getById);
router.post('/tratamientos',     authenticateToken, requireAdmin, TratamientosController.create);
router.put('/tratamientos/:id',  authenticateToken, requireAdmin, TratamientosController.update);

// Agrupar / desagrupar fichas ya existentes
router.post('/tratamientos/:id/fichas',            authenticateToken, requireAdmin, TratamientosController.agregarFicha);
router.delete('/tratamientos/:id/fichas/:fichaId', authenticateToken, requireAdmin, TratamientosController.quitarFicha);

router.delete('/tratamientos/:id', authenticateToken, requireAdmin, TratamientosController.remove);

module.exports = router;

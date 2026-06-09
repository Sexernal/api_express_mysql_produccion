// routes/comandaRoutes.js
const express = require('express');
const router  = express.Router();
const { authenticateToken } = require('../middleware/auth');
const requireAdmin           = require('../middleware/requireAdmin');
const ComandaController      = require('../controllers/comandaController');

// Comanda por ficha
router.get('/fichas/:fichaId/comanda',  authenticateToken,             ComandaController.getByFicha);
router.put('/fichas/:fichaId/comanda',  authenticateToken, requireAdmin, ComandaController.saveComanda);

// Facturación
router.get('/facturacion',                   authenticateToken, ComandaController.listFacturacion);
router.put('/facturacion/:fichaId/cobrar',   authenticateToken, ComandaController.marcarCobrado);

module.exports = router;
// routes/serviciosRoutes.js
const express = require('express');
const router  = express.Router();
const { authenticateToken } = require('../middleware/auth');
const requireAdmin           = require('../middleware/requireAdmin');
const ServiciosController    = require('../controllers/serviciosController');

router.get('/',       authenticateToken,             ServiciosController.list);
router.post('/',      authenticateToken, requireAdmin, ServiciosController.create);
router.put('/:id',    authenticateToken, requireAdmin, ServiciosController.update);
router.delete('/:id', authenticateToken, requireAdmin, ServiciosController.remove);

module.exports = router;
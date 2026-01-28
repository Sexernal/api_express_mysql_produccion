const express = require('express');
const router = express.Router();
const MascotasController = require('../controllers/mascotasController');
const { authenticateToken } = require('../middleware/auth');
const { body, param } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const requireAdmin = require('../middleware/requireAdmin');

router.get('/', authenticateToken, MascotasController.list);
router.get('/:id', authenticateToken, [ param('id').isInt({ min: 1 }).withMessage('ID inválido'), handleValidationErrors ], MascotasController.getById);

router.post('/', authenticateToken, requireAdmin,
  [
    body('nombre').trim().notEmpty().withMessage('Nombre requerido'),
    body('owner_id').isInt({ min: 1 }).withMessage('Propietario inválido'),
    handleValidationErrors
  ],
  MascotasController.create
);

router.put('/:id', authenticateToken, requireAdmin,
  [
    param('id').isInt({ min: 1 }).withMessage('ID inválido'),
    body('nombre').optional().isLength({ min: 1 }),
    handleValidationErrors
  ],
  MascotasController.update
);

router.delete('/:id', authenticateToken, requireAdmin, [ param('id').isInt({ min: 1 }).withMessage('ID inválido'), handleValidationErrors ], MascotasController.remove);

module.exports = router;
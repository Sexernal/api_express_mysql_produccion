const express = require('express');
const router = express.Router();
const PropietariosController = require('../controllers/propietariosController');
const { authenticateToken } = require('../middleware/auth');
const { body, param } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const requireAdmin = require('../middleware/requireAdmin');


router.get('/', authenticateToken, PropietariosController.list);
router.get('/:id', authenticateToken,
  [param('id').isInt({ min: 1 }).withMessage('ID inválido'), handleValidationErrors],
  PropietariosController.getById
);

router.post('/', authenticateToken,requireAdmin,
  [
    body('nombre').trim().notEmpty().withMessage('Nombre es requerido'),
    body('email').isEmail().withMessage('Email inválido'),
    handleValidationErrors
  ],
  PropietariosController.create
);

router.put('/:id', authenticateToken,requireAdmin,
  [
    param('id').isInt({ min: 1 }).withMessage('ID inválido'),
    body('nombre').optional().isLength({ min: 2 }).withMessage('Nombre muy corto'),
    body('email').optional().isEmail().withMessage('Email inválido'),
    handleValidationErrors
  ],
  PropietariosController.update
);

router.delete('/:id', authenticateToken,requireAdmin,
  [param('id').isInt({ min: 1 }).withMessage('ID inválido'), handleValidationErrors],
  PropietariosController.remove
);

module.exports = router;
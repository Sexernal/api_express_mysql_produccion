// routes/propietariosRoutes.js
const express = require('express');
const router = express.Router();
const PropietariosController = require('../controllers/propietariosController');
const { authenticateToken } = require('../middleware/auth');
const { body, param } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const requireAdmin = require('../middleware/requireAdmin');

// Listar propietarios (protegido)
router.get('/', authenticateToken, PropietariosController.list);

// Obtener propia info (propietario autenticado)
router.get('/me', authenticateToken, PropietariosController.getMe);

// Obtener por id
router.get('/:id', authenticateToken,
  [param('id').isInt({ min: 1 }).withMessage('ID inválido'), handleValidationErrors],
  PropietariosController.getById
);

// Crear propietario (solo admin)
router.post('/', authenticateToken, requireAdmin,
  [
    body('nombre').trim().notEmpty().withMessage('Nombre es requerido'),
    body('email').isEmail().withMessage('Email inválido'),
    body('telefono').optional().trim().matches(/^[\+]?[0-9\-\(\)\s]{7,20}$/).withMessage('Teléfono inválido'),
    // password optional pero si viene debe cumplir
    body('password').optional().isLength({ min: 8 }).withMessage('La contraseña debe tener al menos 8 caracteres'),
    handleValidationErrors
  ],
  PropietariosController.create
);

// Actualizar propio perfil (propietario autenticado)
router.put('/me', authenticateToken,
  [
    body('nombre').optional().isLength({ min: 2 }).withMessage('Nombre muy corto'),
    body('email').optional().isEmail().withMessage('Email inválido'),
    body('telefono').optional().trim().matches(/^[\+]?[0-9\-\(\)\s]{7,20}$/).withMessage('Teléfono inválido'),
    body('direccion').optional().isLength({ min: 3 }).withMessage('Dirección inválida'),
    body('password').optional().isLength({ min: 8 }).withMessage('La contraseña debe tener al menos 8 caracteres'),
    handleValidationErrors
  ],
  PropietariosController.updateMe
);

// Actualizar propietario por id (solo admin)
router.put('/:id', authenticateToken, requireAdmin,
  [
    param('id').isInt({ min: 1 }).withMessage('ID inválido'),
    body('nombre').optional().isLength({ min: 2 }).withMessage('Nombre muy corto'),
    body('email').optional().isEmail().withMessage('Email inválido'),
    body('telefono').optional().trim().matches(/^[\+]?[0-9\-\(\)\s]{7,20}$/).withMessage('Teléfono inválido'),
    // password optional para update (si viene y no es vacío, se usará)
    body('password').optional().isLength({ min: 8 }).withMessage('La contraseña debe tener al menos 8 caracteres'),
    handleValidationErrors
  ],
  PropietariosController.update
);

// Eliminar propietario (solo admin)
router.delete('/:id', authenticateToken, requireAdmin,
  [param('id').isInt({ min: 1 }).withMessage('ID inválido'), handleValidationErrors],
  PropietariosController.remove
);

// Login propietario (público — para app móvil)
router.post('/login',
  [
    body('email').isEmail().withMessage('Email inválido'),
    body('password').notEmpty().withMessage('Contraseña requerida'),
    handleValidationErrors
  ],
  PropietariosController.login
);

module.exports = router;
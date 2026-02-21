// routes/citasRoutes.js
const express = require('express');
const router = express.Router();
const CitasController = require('../controllers/citasController');
const { authenticateToken } = require('../middleware/auth');
const { body, param, query } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const requireAdmin = require('../middleware/requireAdmin');

// List (public but auth recommended) - allow filters in query
router.get(
  '/',
  authenticateToken,
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
    handleValidationErrors
  ],
  CitasController.list
);

// Get by id
router.get('/:id',
  authenticateToken,
  [ param('id').isInt({ min: 1 }).withMessage('ID inválido'), handleValidationErrors ],
  CitasController.getById
);

// Create
router.post('/',
  authenticateToken,
  [
    body('mascota_id').isInt({ min: 1 }).withMessage('mascota_id inválido'),
    body('propietario_id').isInt({ min: 1 }).withMessage('propietario_id inválido'),
    body('veterinario_id').optional({ nullable:true }).custom(v => v === null || v === '' || Number.isInteger(Number(v))).withMessage('veterinario_id inválido'),
    body('fecha_inicio').notEmpty().withMessage('fecha_inicio es requerida'),
    body('duracion_min').optional().isInt({ min: 1 }).withMessage('duracion_min inválida'),
    handleValidationErrors
  ],
  CitasController.create
);

// Update
router.put('/:id',
  authenticateToken,
  [
    param('id').isInt({ min: 1 }).withMessage('ID inválido'),
    body('mascota_id').optional().isInt({ min: 1 }),
    body('propietario_id').optional().isInt({ min: 1 }),
    body('veterinario_id').optional({ nullable:true }).custom(v => v === null || v === '' || Number.isInteger(Number(v))),
    body('fecha_inicio').optional().notEmpty(),
    body('duracion_min').optional().isInt({ min: 1 }),
    handleValidationErrors
  ],
  CitasController.update
);

// Delete
router.delete('/:id',
  authenticateToken,
  [ param('id').isInt({ min: 1 }).withMessage('ID inválido'), handleValidationErrors ],
  CitasController.remove
);

module.exports = router;
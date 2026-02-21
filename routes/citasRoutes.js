// routes/citasRoutes.js
const express = require('express');
const router = express.Router();
const CitasController = require('../controllers/citasController');
const { authenticateToken } = require('../middleware/auth');
const { body, param, query } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');

// List
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

// Slots endpoint (nuevo)
router.get(
  '/slots',
  authenticateToken,
  [
    query('date').notEmpty().withMessage('date is required in YYYY-MM-DD format'),
    query('tipo').optional(),
    query('veterinario_id').optional(),
    handleValidationErrors
  ],
  CitasController.getSlots
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

// Confirm handlers
const confirmHandlers = [
  authenticateToken,
  [ param('id').isInt({ min: 1 }).withMessage('ID inválido'), handleValidationErrors ],
  CitasController.confirm
];
router.post('/:id/confirm', ...confirmHandlers);
router.put('/:id/confirm', ...confirmHandlers);
router.patch('/:id/confirm', ...confirmHandlers);

// Complete handlers
const completeHandlers = [
  authenticateToken,
  [ param('id').isInt({ min: 1 }).withMessage('ID inválido'), handleValidationErrors ],
  CitasController.complete
];
router.post('/:id/complete', ...completeHandlers);
router.put('/:id/complete', ...completeHandlers);
router.patch('/:id/complete', ...completeHandlers);

// Status
const statusHandlers = [
  authenticateToken,
  [
    param('id').isInt({ min: 1 }).withMessage('ID inválido'),
    body('estado').isIn(['pendiente','confirmada','completada','cancelada']).withMessage('Estado inválido'),
    handleValidationErrors
  ],
  CitasController.changeStatus
];
router.patch('/:id/status', ...statusHandlers);
router.put('/:id/status', ...statusHandlers);
router.post('/:id/status', ...statusHandlers);

// Delete
router.delete('/:id',
  authenticateToken,
  [ param('id').isInt({ min: 1 }).withMessage('ID inválido'), handleValidationErrors ],
  CitasController.remove
);

module.exports = router;
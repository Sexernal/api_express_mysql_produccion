// middleware/validation.js
const { body, param } = require('express-validator');

const validateUser = [
  body('nombre').trim().notEmpty().withMessage('El nombre es requerido')
    .isLength({ min: 2, max: 100 }).withMessage('El nombre debe tener entre 2 y 100 caracteres')
    .matches(/^[a-zA-ZÀ-ÿ\u00f1\u00d1\s]+$/).withMessage('El nombre solo puede contener letras y espacios'),
  body('email').trim().notEmpty().withMessage('El email es requerido')
    .isEmail().withMessage('Debe ser un email válido').normalizeEmail()
    .isLength({ max: 255 }).withMessage('El email no puede exceder 255 caracteres'),
  body('telefono').trim().notEmpty().withMessage('El teléfono es requerido')
    .matches(/^[\+]?[0-9\-\(\)\s]{7,20}$/).withMessage('Formato de teléfono inválido')
    .isLength({ min: 7, max: 20 }).withMessage('El teléfono debe tener entre 7 y 20 caracteres'),
];

const validateRegister = [
  body('nombre').trim().notEmpty().withMessage('El nombre es requerido')
    .isLength({ min: 2, max: 100 }).withMessage('El nombre debe tener entre 2 y 100 caracteres')
    .matches(/^[a-zA-ZÀ-ÿ\u00f1\u00d1\s]+$/).withMessage('El nombre solo puede contener letras y espacios'),
  body('email').trim().notEmpty().withMessage('El email es requerido')
    .isEmail().withMessage('Debe ser un email válido').normalizeEmail()
    .isLength({ max: 255 }).withMessage('El email no puede exceder 255 caracteres'),
  body('telefono').trim().notEmpty().withMessage('El teléfono es requerido')
    .matches(/^[\+]?[0-9\-\(\)\s]{7,20}$/).withMessage('Formato de teléfono inválido')
    .isLength({ min: 7, max: 20 }).withMessage('El teléfono debe tener entre 7 y 20 caracteres'),
  body('password').isLength({ min: 8, max: 128 })
    .withMessage('La contraseña debe tener entre 8 y 128 caracteres')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('La contraseña debe contener: 1 minúscula, 1 mayúscula, 1 número y 1 carácter especial'),
];

const validateLogin = [
  body('email').trim().notEmpty().withMessage('El email es requerido')
    .isEmail().withMessage('Debe ser un email válido').normalizeEmail(),
  body('password').notEmpty().withMessage('La contraseña es requerida'),
];

// Login con cédula costarricense (9 dígitos)
const validateLoginCedula = [
  body('cedula').trim()
    .notEmpty().withMessage('La cédula es requerida')
    .matches(/^\d{9}$/).withMessage('La cédula debe tener exactamente 9 dígitos'),
  body('password').notEmpty().withMessage('La contraseña es requerida'),
];

// Crear personal (doctor/recepcionista) con contraseña maestra
const validateRegisterStaff = [
  body('masterPassword').notEmpty().withMessage('La contraseña maestra es requerida'),
  body('cedula').trim()
    .notEmpty().withMessage('La cédula es requerida')
    .matches(/^\d{9}$/).withMessage('La cédula debe tener exactamente 9 dígitos'),
  body('password').isLength({ min: 6, max: 128 })
    .withMessage('La contraseña debe tener entre 6 y 128 caracteres'),
  body('role').isIn(['admin', 'user'])
    .withMessage('El rol debe ser admin (veterinario) o user (recepcionista)'),
];

const validateProfileUpdate = [
  body('nombre').optional().trim()
    .isLength({ min: 2, max: 100 }).withMessage('El nombre debe tener entre 2 y 100 caracteres')
    .matches(/^[a-zA-ZÀ-ÿ\u00f1\u00d1\s]+$/).withMessage('El nombre solo puede contener letras y espacios'),
  body('email').optional().trim()
    .isEmail().withMessage('Debe ser un email válido').normalizeEmail()
    .isLength({ max: 255 }).withMessage('El email no puede exceder 255 caracteres'),
  body('telefono').optional().trim()
    .matches(/^[\+]?[0-9\-\(\)\s]{7,20}$/).withMessage('Formato de teléfono inválido')
    .isLength({ min: 7, max: 20 }).withMessage('El teléfono debe tener entre 7 y 20 caracteres'),
  body('direccion').optional().trim()
    .isLength({ max: 255 }).withMessage('Dirección máximo 255 caracteres'),
  body('especialidad').optional().trim()
    .isLength({ max: 150 }).withMessage('Especialidad máximo 150 caracteres'),
  body('currentPassword').optional()
    .notEmpty().withMessage('La contraseña actual no puede estar vacía'),
    body('newPassword').optional()
    .isLength({ min: 6, max: 128 }).withMessage('La nueva contraseña debe tener entre 6 y 128 caracteres'),
];

const validateUserId = [
  param('id').isInt({ min: 1 }).withMessage('El ID debe ser un número entero positivo'),
];

const validatePagination = [
  body('page').optional().isInt({ min: 1 }).withMessage('La página debe ser un número entero positivo'),
  body('limit').optional().isInt({ min: 1, max: 100 }).withMessage('El límite debe ser un número entre 1 y 100'),
];

const validateSearch = [
  body('q').trim().isLength({ min: 1, max: 100 }).withMessage('El término de búsqueda debe tener entre 1 y 100 caracteres'),
];

const validateUserPartial = [
  body('nombre').optional().trim()
    .isLength({ min: 2, max: 100 }).withMessage('El nombre debe tener entre 2 y 100 caracteres')
    .matches(/^[a-zA-ZÀ-ÿ\u00f1\u00d1\s]+$/).withMessage('El nombre solo puede contener letras y espacios'),
  body('email').optional().trim()
    .isEmail().withMessage('Debe ser un email válido').normalizeEmail()
    .isLength({ max: 255 }).withMessage('El email no puede exceder 255 caracteres'),
  body('telefono').optional().trim()
    .matches(/^[\+]?[0-9\-\(\)\s]{7,20}$/).withMessage('Formato de teléfono inválido')
    .isLength({ min: 7, max: 20 }).withMessage('El teléfono debe tener entre 7 y 20 caracteres'),
];

const sanitizeInput = (req, res, next) => {
  if (req.body) {
    Object.keys(req.body).forEach(key => {
      if (typeof req.body[key] === 'string') req.body[key] = req.body[key].trim();
    });
    Object.keys(req.body).forEach(key => {
      if (req.body[key] === '' || req.body[key] === null || req.body[key] === undefined) {
        delete req.body[key];
      }
    });
  }
  next();
};

const validateJSON = (err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ success: false, message: 'JSON malformado', error: 'La estructura del JSON enviado no es válida' });
  }
  next(err);
};

const handleValidationErrors = (req, res, next) => {
  const { validationResult } = require('express-validator');
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Errores de validación',
      errors: errors.array().map(error => ({ field: error.path || error.param, message: error.msg, value: error.value })),
    });
  }
  next();
};

const validateContentType = (req, res, next) => {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return next();
  const ct = (req.headers['content-type'] || '').toLowerCase();
  if (ct.includes('multipart/form-data')) return next();
  if (ct.includes('application/json'))    return next();
  return res.status(400).json({ success: false, message: 'Content-Type debe ser application/json o multipart/form-data' });
};

module.exports = {
  validateUser,
  validateRegister,
  validateLogin,
  validateLoginCedula,
  validateRegisterStaff,
  validateProfileUpdate,
  validateUserId,
  validatePagination,
  validateSearch,
  validateUserPartial,
  sanitizeInput,
  validateJSON,
  handleValidationErrors,
  validateContentType,
};
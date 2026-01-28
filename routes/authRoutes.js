/**
 * routes/authRoutes.js
 * Rutas de Autenticación
 */

const express = require('express');
const router = express.Router();
const AuthController = require('../controllers/authController');
const { authenticateToken } = require('../middleware/auth');
const requireAdmin = require('../middleware/requireAdmin'); // middleware para permitir solo admins
const {
  validateRegister,
  validateLogin,
  validateProfileUpdate
} = require('../middleware/validation');

/**
 * @route POST /auth/register
 * @description Registra un nuevo usuario (público)
 * @access Public
 * Nota: el servidor debe forzar role = 'user' al crear usuarios desde aquí.
 */
router.post('/register', validateRegister, AuthController.register);

/**
 * @route POST /auth/register-admin
 * @description Crea un usuario con role = 'admin'
 * @access Private (solo administradores)
 * Requiere: authenticateToken -> requireAdmin
 */
router.post('/register-admin', authenticateToken, requireAdmin, validateRegister, AuthController.registerAdmin);

/**
 * @route POST /auth/login
 * @description Autentica un usuario existente
 * @access Public
 */
router.post('/login', validateLogin, AuthController.login);

/**
 * @route GET /auth/profile
 * @description Obtiene el perfil del usuario autenticado
 * @access Private (requiere token JWT)
 */
router.get('/profile', authenticateToken, AuthController.getProfile);

/**
 * @route PUT /auth/profile
 * @description Actualiza el perfil del usuario autenticado
 * @access Private (requiere token JWT)
 */
router.put('/profile', authenticateToken, validateProfileUpdate, AuthController.updateProfile);

/**
 * @route POST /auth/refresh
 * @description Renueva el token JWT
 * @access Private (requiere token JWT)
 */
router.post('/refresh', authenticateToken, AuthController.refreshToken);

/**
 * @route POST /auth/logout
 * @description Cierra sesión del usuario
 * @access Private (requiere token JWT)
 */
router.post('/logout', authenticateToken, AuthController.logout);

module.exports = router;
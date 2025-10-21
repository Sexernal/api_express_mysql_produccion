/**
 * Rutas de Autenticación
 * @description Define todas las rutas para autenticación (registro, login, perfil)
 */

const express = require('express');
const router = express.Router();
const AuthController = require('../controllers/authController');
const { authenticateToken } = require('../middleware/auth');
const { 
    validateRegister, 
    validateLogin, 
    validateProfileUpdate 
} = require('../middleware/validation');

/**
 * @route POST /auth/register
 * @description Registra un nuevo usuario
 * @access Public
 * @body {string} nombre - Nombre completo del usuario (requerido)
 * @body {string} email - Email único del usuario (requerido)
 * @body {string} telefono - Número de teléfono del usuario (requerido)
 * @body {string} password - Contraseña (mín. 8 caracteres, mayús., minús., número, carácter especial)
 * @returns {Object} Usuario creado y token JWT
 */
router.post('/register', validateRegister, AuthController.register);

/**
 * @route POST /auth/login
 * @description Autentica un usuario existente
 * @access Public
 * @body {string} email - Email del usuario (requerido)
 * @body {string} password - Contraseña del usuario (requerido)
 * @returns {Object} Datos del usuario y token JWT
 */
router.post('/login', validateLogin, AuthController.login);

/**
 * @route GET /auth/profile
 * @description Obtiene el perfil del usuario autenticado
 * @access Private (requiere token JWT)
 * @header {string} Authorization - Bearer token
 * @returns {Object} Datos del perfil del usuario
 */
router.get('/profile', authenticateToken, AuthController.getProfile);

/**
 * @route PUT /auth/profile
 * @description Actualiza el perfil del usuario autenticado
 * @access Private (requiere token JWT)
 * @header {string} Authorization - Bearer token
 * @body {string} [nombre] - Nuevo nombre del usuario (opcional)
 * @body {string} [email] - Nuevo email del usuario (opcional)
 * @body {string} [telefono] - Nuevo teléfono del usuario (opcional)
 * @body {string} [currentPassword] - Contraseña actual (requerida si se cambia contraseña)
 * @body {string} [newPassword] - Nueva contraseña (opcional)
 * @returns {Object} Datos actualizados del usuario
 */
router.put('/profile', authenticateToken, validateProfileUpdate, AuthController.updateProfile);

/**
 * @route POST /auth/refresh
 * @description Renueva el token JWT
 * @access Private (requiere token JWT)
 * @header {string} Authorization - Bearer token
 * @returns {Object} Nuevo token JWT
 */
router.post('/refresh', authenticateToken, AuthController.refreshToken);

/**
 * @route POST /auth/logout
 * @description Cierra sesión del usuario
 * @access Private (requiere token JWT)
 * @header {string} Authorization - Bearer token
 * @returns {Object} Mensaje de confirmación
 */
router.post('/logout', authenticateToken, AuthController.logout);

module.exports = router;
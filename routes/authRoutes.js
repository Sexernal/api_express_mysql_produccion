/**
 * routes/authRoutes.js
 */
const express = require('express');
const router = express.Router();
const AuthController = require('../controllers/authController');
const { authenticateToken } = require('../middleware/auth');
const requireAdmin = require('../middleware/requireAdmin');
const { validateRegister, validateLogin, validateProfileUpdate } = require('../middleware/validation');

// Registrar usuario normal — protegido: solo admins pueden crear usuarios
router.post('/register', authenticateToken, requireAdmin, validateRegister, AuthController.register);

// Registrar admin — protegido: solo admins
router.post('/register-admin', authenticateToken, requireAdmin, validateRegister, AuthController.registerAdmin);

router.post('/login', validateLogin, AuthController.login);
router.get('/profile', authenticateToken, AuthController.getProfile);
router.put('/profile', authenticateToken, validateProfileUpdate, AuthController.updateProfile);
router.post('/refresh', authenticateToken, AuthController.refreshToken);
router.post('/logout', authenticateToken, AuthController.logout);

module.exports = router;
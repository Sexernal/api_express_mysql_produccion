// routes/authRoutes.js
const express = require('express');
const router  = express.Router();
const AuthController = require('../controllers/authController');
const PasswordResetController = require('../controllers/passwordResetController');
const { authenticateToken } = require('../middleware/auth');
const requireAdmin = require('../middleware/requireAdmin');
const requirePermiso           = require('../middleware/requirePermiso');
const {
  validateRegister,
  validateLoginCedula,
  validateRegisterStaff,
  validateProfileUpdate,
} = require('../middleware/validation');

// ── Rutas públicas (sin JWT) ──────────────────────────────────────────────────
router.post('/verify-master',  AuthController.verifyMasterPassword);
router.post('/register-staff', validateRegisterStaff, AuthController.registerStaff);
router.post('/login',          validateLoginCedula, AuthController.login);

// ── Restablecer contraseña (público — el doctor está fuera del sistema) ───────
// El enlace del correo trae el token; verificar NO lo gasta, confirmar sí.
router.post('/password-reset/solicitar', PasswordResetController.solicitarUsuario);
router.get('/password-reset/verificar',  PasswordResetController.verificarUsuario);
router.post('/password-reset/confirmar', PasswordResetController.confirmarUsuario);

// ── Rutas protegidas ──────────────────────────────────────────────────────────
router.get('/profile',  authenticateToken, AuthController.getProfile);
router.put('/profile',  authenticateToken, validateProfileUpdate, AuthController.updateProfile);
router.post('/refresh', authenticateToken, AuthController.refreshToken);
router.post('/logout',  authenticateToken, AuthController.logout);

// ── Legacy (solo admins logueados) ────────────────────────────────────────────
router.post('/register',       authenticateToken, requirePermiso('usuarios.gestionar'), validateRegister, AuthController.register);
router.post('/register-admin', authenticateToken, requirePermiso('usuarios.gestionar'), validateRegister, AuthController.registerAdmin);

module.exports = router;
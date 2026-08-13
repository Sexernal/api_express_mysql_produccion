/**
 * routes/userRoutes.js
 */
const express = require('express');
const router = express.Router();
const UserController = require('../controllers/userController');
const { authenticateToken } = require('../middleware/auth');
const requireAdmin = require('../middleware/requireAdmin');
const requirePermiso           = require('../middleware/requirePermiso');
const { validateUser, validateUserId } = require('../middleware/validation');

// Lectura: cualquier usuario autenticado
router.get('/',        authenticateToken, UserController.getAllUsers);
router.get('/search',  authenticateToken, UserController.searchUsers);
router.get('/stats',   authenticateToken, UserController.getUserStats);
router.get('/:id',     authenticateToken, validateUserId, UserController.getUserById);

// Escritura: solo admins
router.post('/',       authenticateToken, requirePermiso('usuarios.gestionar'), validateUser, UserController.createUser);
router.put('/:id',     authenticateToken, requirePermiso('usuarios.gestionar'), validateUserId, validateUser, UserController.updateUser);
router.delete('/:id',  authenticateToken, requirePermiso('usuarios.gestionar'), validateUserId, UserController.deleteUser);

module.exports = router;


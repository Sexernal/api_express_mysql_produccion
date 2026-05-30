/**
 * routes/userRoutes.js
 */
const express = require('express');
const router = express.Router();
const UserController = require('../controllers/userController');
const { authenticateToken } = require('../middleware/auth');
const requireAdmin = require('../middleware/requireAdmin');
const { validateUser, validateUserId } = require('../middleware/validation');

// Lectura: cualquier usuario autenticado
router.get('/',        authenticateToken, UserController.getAllUsers);
router.get('/search',  authenticateToken, UserController.searchUsers);
router.get('/stats',   authenticateToken, UserController.getUserStats);
router.get('/:id',     authenticateToken, validateUserId, UserController.getUserById);

// Escritura: solo admins
router.post('/',       authenticateToken, requireAdmin, validateUser, UserController.createUser);
router.put('/:id',     authenticateToken, requireAdmin, validateUserId, validateUser, UserController.updateUser);
router.delete('/:id',  authenticateToken, requireAdmin, validateUserId, UserController.deleteUser);

module.exports = router;

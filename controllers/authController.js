/**
 * controllers/authController.js
 * Controlador de Autenticación (register, login, profile, update, refresh, logout)
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const db = require('../db'); // tu pool / fachada
const { validationResult } = require('express-validator');

class AuthController {
  // Registro público: crea usuarios con role = 'user' (salvo si no hay usuarios -> primer usuario = admin)
  static async register(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Errores de validación', errors: errors.array() });
      }

      const { nombre, email, telefono, password } = req.body;

      // Evitar que el cliente intente imponer role
      // Role se determina en el servidor (por seguridad)
      let role = 'user';

      // Verificar si el email ya existe
      const existingUser = await User.findByEmail(email);
      if (existingUser) {
        return res.status(409).json({ success: false, message: 'El email ya está registrado' });
      }

      // Si no hay usuarios en la tabla -> convertir primer usuario en admin (útil para bootstrap)
      try {
        const [countRows] = await db.query('SELECT COUNT(*) AS c FROM usuarios');
        const totalUsers = (Array.isArray(countRows) && countRows[0] && typeof countRows[0].c === 'number') ? countRows[0].c : Number(countRows[0]?.c || 0);
        if (totalUsers === 0) {
          role = 'admin';
        }
      } catch (errCount) {
        // Si falla el count, no bloquear; asumimos role = 'user'
        console.warn('No se pudo obtener count de usuarios, role será "user" por defecto', errCount.message || errCount);
      }

      // Hash password
      const saltRounds = 12;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      // Crear usuario (User.create debe aceptar role en el objeto)
      const newUser = await User.create({
        nombre,
        email,
        telefono,
        password: hashedPassword,
        role
      });

      const safeUser = {
        id: newUser.id,
        nombre: newUser.nombre,
        email: newUser.email,
        telefono: newUser.telefono,
        role: newUser.role || role,
        created_at: newUser.created_at || null
      };

      // Generar token incluyendo role
      const token = jwt.sign(
        { userId: safeUser.id, email: safeUser.email, role: safeUser.role },
        process.env.JWT_SECRET || 'default_secret_key',
        { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
      );

      // Devolver user + token (esto permite login automático tras registro)
      res.status(201).json({
        success: true,
        message: 'Usuario registrado correctamente',
        data: { user: safeUser, token, expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
      });
    } catch (error) {
      console.error('Error en register:', error);
      res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
    }
  }

  // Registro de admin (ruta protegida por authenticateToken + requireAdmin)
  static async registerAdmin(req, res) {
    try {
      // Validaciones (puedes reutilizar validateRegister middleware en la ruta)
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Errores de validación', errors: errors.array() });
      }

      // Asegurar que el middleware requireAdmin ya verificó req.user.role === 'admin'
      // Pero por seguridad comprobamos de nuevo:
      if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Acceso denegado: solo administradores pueden crear admins' });
      }

      const { nombre, email, telefono, password } = req.body;

      // Verificar email existente
      const existingUser = await User.findByEmail(email);
      if (existingUser) {
        return res.status(409).json({ success: false, message: 'El email ya está registrado' });
      }

      // Hashear contraseña
      const saltRounds = 12;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      // Forzamos role = 'admin' (ignorar cualquier role enviado desde cliente)
      const newUser = await User.create({
        nombre,
        email,
        telefono,
        password: hashedPassword,
        role: 'admin'
      });

      const safeUser = {
        id: newUser.id,
        nombre: newUser.nombre,
        email: newUser.email,
        telefono: newUser.telefono,
        role: newUser.role || 'admin',
        created_at: newUser.created_at || null
      };

      res.status(201).json({
        success: true,
        message: 'Administrador creado correctamente',
        data: { user: safeUser }
      });
    } catch (error) {
      console.error('Error en registerAdmin:', error);
      res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
    }
  }

  // Login: ya incluías role en token — no cambié la lógica (solo pequeño harden)
  static async login(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Errores de validación', errors: errors.array() });
      }

      const { email, password } = req.body;
      const user = await User.findByEmailWithPassword(email);
      if (!user) {
        return res.status(401).json({ success: false, message: 'Credenciales inválidas' });
      }

      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({ success: false, message: 'Credenciales inválidas' });
      }

      const safeUser = {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        telefono: user.telefono,
        role: user.role || 'user',
        created_at: user.created_at || null
      };

      const token = jwt.sign(
        { userId: safeUser.id, email: safeUser.email, role: safeUser.role },
        process.env.JWT_SECRET || 'default_secret_key',
        { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
      );

      res.status(200).json({
        success: true,
        message: 'Login exitoso',
        data: { user: safeUser, token, expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
      });
    } catch (error) {
      console.error('Error en login:', error);
      res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
    }
  }

  // Perfil (sin cambios importantes)
  static async getProfile(req, res) {
    try {
      const userId = req.user.userId;
      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });

      const safeUser = {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        telefono: user.telefono,
        role: user.role,
        created_at: user.created_at || null
      };

      res.status(200).json({ success: true, message: 'Perfil obtenido correctamente', data: safeUser });
    } catch (error) {
      console.error('Error en getProfile:', error);
      res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
    }
  }

  // Update profile (sin cambios en la semántica)
  static async updateProfile(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Errores de validación', errors: errors.array() });
      }

      const userId = req.user.userId;
      const { nombre, email, telefono, currentPassword, newPassword } = req.body;

      const existingUser = await User.findByEmailWithPassword(req.user.email);
      if (!existingUser) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });

      let updateData = { nombre, email, telefono };

      if (newPassword) {
        if (!currentPassword) return res.status(400).json({ success: false, message: 'La contraseña actual es requerida para cambiar la contraseña' });
        const isCurrentPasswordValid = await bcrypt.compare(currentPassword, existingUser.password);
        if (!isCurrentPasswordValid) return res.status(401).json({ success: false, message: 'Contraseña actual incorrecta' });
        const saltRounds = 12;
        updateData.password = await bcrypt.hash(newPassword, saltRounds);
      }

      if (email && email !== existingUser.email) {
        const emailUser = await User.findByEmail(email);
        if (emailUser && emailUser.id !== userId) return res.status(409).json({ success: false, message: 'El email ya está registrado en otro usuario' });
      }

      const updatedUser = await User.update(userId, updateData);

      const safeUser = {
        id: updatedUser.id,
        nombre: updatedUser.nombre,
        email: updatedUser.email,
        telefono: updatedUser.telefono,
        role: updatedUser.role,
        created_at: updatedUser.created_at || null
      };

      res.status(200).json({ success: true, message: 'Perfil actualizado correctamente', data: safeUser });
    } catch (error) {
      console.error('Error en updateProfile:', error);
      res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
    }
  }

  // Refresh token
  static async refreshToken(req, res) {
    try {
      const userId = req.user.userId;
      const email = req.user.email;
      const role = req.user.role || 'user';
      const newToken = jwt.sign(
        { userId, email, role },
        process.env.JWT_SECRET || 'default_secret_key',
        { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
      );
      res.status(200).json({ success: true, message: 'Token renovado correctamente', data: { token: newToken, expiresIn: process.env.JWT_EXPIRES_IN || '24h' } });
    } catch (error) {
      console.error('Error en refreshToken:', error);
      res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
    }
  }

  // Logout
  static async logout(req, res) {
    try {
      res.status(200).json({ success: true, message: 'Logout exitoso', data: { message: 'Token invalidado. Elimina el token del cliente.' } });
    } catch (error) {
      console.error('Error en logout:', error);
      res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
    }
  }
}

module.exports = AuthController;
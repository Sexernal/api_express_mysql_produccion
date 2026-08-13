// controllers/authController.js
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const User   = require('../models/User');
const db     = require('../db');
const { puede, etiquetaRol, permisosDe } = require('../services/permisos');
const { validationResult } = require('express-validator');

function makeSafeUser(user) {
  return {
    id:           user.id,
    cedula:       user.cedula       || null,
    nombre:       user.nombre       || null,
    email:        user.email        || null,
    telefono:     user.telefono     || null,
    role:         user.role         || 'user',
    especialidad: user.especialidad || null,
    direccion:    user.direccion    || null,
    created_at:   user.created_at   || user.fecha_creacion || null,
    // El frontend usa esto para decidir qué botones dibuja, en vez de
    // deducirlo del nombre del rol. Si mañana cambia la matriz de permisos,
    // la interfaz se ajusta sola sin tocar cada pantalla.
    role_label:   etiquetaRol(user.role),
    permisos:     permisosDe(user.role),
  };
}

class AuthController {
  // Registro público legacy
  static async register(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Errores de validación', errors: errors.array() });
      }

      const { nombre, email, telefono, password } = req.body;
      let role = 'user';

      const existingUser = await User.findByEmail(email);
      if (existingUser) {
        return res.status(409).json({ success: false, message: 'El email ya está registrado' });
      }

      try {
        const [countRows] = await db.query('SELECT COUNT(*) AS c FROM usuarios');
        if (Number(countRows[0]?.c || 0) === 0) role = 'admin';
      } catch (e) {
        console.warn('No se pudo obtener count de usuarios', e.message);
      }

      const hashedPassword = await bcrypt.hash(password, 12);
      const newUser  = await User.create({ nombre, email, telefono, password: hashedPassword, role });
      const safeUser = makeSafeUser(newUser);
      const token    = jwt.sign(
        { userId: safeUser.id, email: safeUser.email, role: safeUser.role },
        process.env.JWT_SECRET || 'default_secret_key',
        { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
      );

      res.status(201).json({
        success: true,
        message: 'Usuario registrado correctamente',
        data: { user: safeUser, token, expiresIn: process.env.JWT_EXPIRES_IN || '24h' },
      });
    } catch (error) {
      console.error('Error en register:', error);
      res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
    }
  }

  // Registro de admin (ruta protegida)
  static async registerAdmin(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Errores de validación', errors: errors.array() });
      }

      if (!req.user || !puede(req.user.role, 'usuarios.gestionar')) {
        return res.status(403).json({ success: false, message: 'Acceso denegado: solo administradores' });
      }

      const { nombre, email, telefono, password } = req.body;
      const existingUser = await User.findByEmail(email);
      if (existingUser) {
        return res.status(409).json({ success: false, message: 'El email ya está registrado' });
      }

      const hashedPassword = await bcrypt.hash(password, 12);
      const newUser = await User.create({ nombre, email, telefono, password: hashedPassword, role: 'admin' });

      res.status(201).json({
        success: true,
        message: 'Administrador creado correctamente',
        data: { user: makeSafeUser(newUser) },
      });
    } catch (error) {
      console.error('Error en registerAdmin:', error);
      res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
    }
  }

  // Verificar contraseña maestra (sin JWT) — para el modal de crear personal
  static async verifyMasterPassword(req, res) {
    try {
      const { masterPassword } = req.body;
      if (!masterPassword) {
        return res.status(400).json({ success: false, message: 'La contraseña maestra es requerida' });
      }
      const master = process.env.MASTER_PASSWORD;
      if (!master) {
        return res.status(500).json({ success: false, message: 'Contraseña maestra no configurada en el servidor' });
      }
      if (masterPassword !== master) {
        return res.status(401).json({ success: false, message: 'Contraseña maestra incorrecta' });
      }
      res.json({ success: true, message: 'Contraseña correcta' });
    } catch (error) {
      console.error('Error en verifyMasterPassword:', error);
      res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
  }

  // Crear personal (doctor o recepcionista) con cédula + contraseña
  static async registerStaff(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Errores de validación', errors: errors.array() });
      }

      const { masterPassword, cedula, password, role } = req.body;

      const master = process.env.MASTER_PASSWORD;
      if (!master || masterPassword !== master) {
        return res.status(401).json({ success: false, message: 'Contraseña maestra incorrecta' });
      }

      const existing = await User.findByCedula(cedula);
      if (existing) {
        return res.status(409).json({ success: false, message: 'La cédula ya está registrada' });
      }

      const hashedPassword = await bcrypt.hash(password, 12);
      const newUser = await User.create({ cedula, password: hashedPassword, role });

      res.status(201).json({
        success: true,
        message: `${role === 'admin' ? 'Doctor' : 'Recepcionista'} creado correctamente`,
        data: { user: makeSafeUser(newUser) },
      });
    } catch (error) {
      console.error('Error en registerStaff:', error);
      res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
    }
  }

  // Login con cédula
  static async login(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Errores de validación', errors: errors.array() });
      }

      const { cedula, password } = req.body;
      const user = await User.findByCedulaWithPassword(cedula);
      if (!user) {
        return res.status(401).json({ success: false, message: 'Credenciales inválidas' });
      }

      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({ success: false, message: 'Credenciales inválidas' });
      }

      const safeUser = makeSafeUser(user);
      const token    = jwt.sign(
        { userId: safeUser.id, email: safeUser.email, role: safeUser.role },
        process.env.JWT_SECRET || 'default_secret_key',
        { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
      );

      res.status(200).json({
        success: true,
        message: 'Login exitoso',
        data: { user: safeUser, token, expiresIn: process.env.JWT_EXPIRES_IN || '24h' },
      });
    } catch (error) {
      console.error('Error en login:', error);
      res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
    }
  }

  static async getProfile(req, res) {
    try {
      const userId = req.user.userId;
      const user   = await User.findById(userId);
      if (!user) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
      res.status(200).json({ success: true, message: 'Perfil obtenido correctamente', data: makeSafeUser(user) });
    } catch (error) {
      console.error('Error en getProfile:', error);
      res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
    }
  }

  static async updateProfile(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Errores de validación', errors: errors.array() });
      }

      const userId       = req.user.userId;
      const existingUser = await User.findByIdWithPassword(userId);
      if (!existingUser) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });

      const { nombre, email, telefono, direccion, especialidad, currentPassword, newPassword } = req.body;
      const updateData = {};

      if (nombre      !== undefined) updateData.nombre      = nombre;
      if (email       !== undefined) updateData.email       = email;
      if (telefono    !== undefined) updateData.telefono    = telefono;
      if (direccion   !== undefined) updateData.direccion   = direccion;
      if (existingUser.role === 'admin' && especialidad !== undefined) {
        updateData.especialidad = especialidad;
      }

      if (newPassword) {
        if (!currentPassword) {
          return res.status(400).json({ success: false, message: 'La contraseña actual es requerida para cambiarla' });
        }
        const valid = await bcrypt.compare(currentPassword, existingUser.password);
        if (!valid) {
          return res.status(401).json({ success: false, message: 'Contraseña actual incorrecta' });
        }
        updateData.password = await bcrypt.hash(newPassword, 12);
      }

      if (email && email !== existingUser.email) {
        const emailUser = await User.findByEmail(email);
        if (emailUser && emailUser.id !== userId) {
          return res.status(409).json({ success: false, message: 'El email ya está registrado en otro usuario' });
        }
      }

      const updatedUser = await User.update(userId, updateData);
      res.status(200).json({ success: true, message: 'Perfil actualizado correctamente', data: makeSafeUser(updatedUser) });
    } catch (error) {
      console.error('Error en updateProfile:', error);
      res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
    }
  }

  static async refreshToken(req, res) {
    try {
      const { userId, email, role } = req.user;
      const newToken = jwt.sign(
        { userId, email, role },
        process.env.JWT_SECRET || 'default_secret_key',
        { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
      );
      res.status(200).json({
        success: true,
        message: 'Token renovado correctamente',
        data: { token: newToken, expiresIn: process.env.JWT_EXPIRES_IN || '24h' },
      });
    } catch (error) {
      console.error('Error en refreshToken:', error);
      res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
    }
  }

  static async logout(req, res) {
    try {
      res.status(200).json({
        success: true,
        message: 'Logout exitoso',
        data: { message: 'Token invalidado. Elimina el token del cliente.' },
      });
    } catch (error) {
      console.error('Error en logout:', error);
      res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
    }
  }
}

module.exports = AuthController;
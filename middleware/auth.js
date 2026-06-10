// middleware/auth.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const db = require('../db');

const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token de acceso requerido',
        error: 'No se proporcionó token de autenticación'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default_secret_key');

    // Si el token identifica al usuario como propietario, buscar directo en propietarios
    if (decoded.role === 'propietario') {
      const [rows] = await db.query('SELECT id, nombre, email FROM propietarios WHERE id = ?', [decoded.userId]);
      if (rows && rows.length) {
        req.user = {
          userId: decoded.userId,
          email: decoded.email || rows[0].email,
          role: 'propietario',
          nombre: rows[0].nombre
        };
        return next();
      }
      return res.status(401).json({
        success: false,
        message: 'Token inválido',
        error: 'El propietario asociado al token no existe'
      });
    }

    // Para roles admin/user buscar en tabla usuarios
    let user = null;
    try {
      user = await User.findById(decoded.userId);
    } catch (e) {
      user = null;
    }

    if (user) {
      req.user = {
        userId: decoded.userId,
        email: decoded.email,
        role: user.role || decoded.role || 'user'
      };
      return next();
    }

    return res.status(401).json({
      success: false,
      message: 'Token inválido',
      error: 'El usuario asociado al token no existe'
    });

  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Token inválido',
        error: 'El token proporcionado no es válido'
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expirado',
        error: 'El token ha expirado, por favor inicia sesión nuevamente'
      });
    }
    console.error('Error en authenticateToken:', error);
    return res.status(500).json({
      success: false,
      message: 'Error de autenticación',
      error: 'Error interno del servidor'
    });
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return next();

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default_secret_key');

    if (decoded.role === 'propietario') {
      const [rows] = await db.query('SELECT id, nombre, email FROM propietarios WHERE id = ?', [decoded.userId]);
      if (rows && rows.length) {
        req.user = {
          userId: decoded.userId,
          email: decoded.email || rows[0].email,
          role: 'propietario',
          nombre: rows[0].nombre
        };
      }
      return next();
    }

    let user = null;
    try { user = await User.findById(decoded.userId); } catch (e) { user = null; }

    if (user) {
      req.user = { userId: decoded.userId, email: decoded.email, role: user.role || decoded.role || 'user' };
    }

    next();
  } catch (err) {
    next();
  }
};

const authorizeRoles = (allowedRoles = []) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Autenticación requerida' });
    }
    if (allowedRoles.length && !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'No tienes permisos para acceder a este recurso' });
    }
    next();
  };
};

const verifyOwnership = (req, res, next) => {
  const requestedUserId = parseInt(req.params.id);
  const currentUserId = req.user.userId;
  if (requestedUserId !== currentUserId) {
    return res.status(403).json({
      success: false,
      message: 'No tienes permisos para acceder a este recurso',
      error: 'Solo puedes acceder a tu propia información'
    });
  }
  next();
};

module.exports = {
  authenticateToken,
  optionalAuth,
  authorizeRoles,
  verifyOwnership
};
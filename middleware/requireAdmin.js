module.exports = function requireAdmin(req, res, next) {
  // necesita que authenticateToken ya haya puesto req.user (userId,email,role)
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Autenticación requerida' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Acceso denegado: se requiere rol admin' });
  }
  next();
};
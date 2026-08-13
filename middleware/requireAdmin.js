// middleware/requireAdmin.js
//
// Exige ser personal clínico: veterinario ('admin') o administración
// ('superadmin'). El nombre se mantiene porque lo usan ~25 rutas y
// renombrarlo no aportaría nada.
//
// Antes comparaba `role !== 'admin'` a secas, lo que dejaba fuera al
// super admin de TODO el sistema. Ahora delega en la matriz de permisos.
//
// Para reglas más finas —las que solo puede el super admin, como reportes
// o el catálogo de servicios— usa requirePermiso('...') en vez de este.
const { esPersonalClinico } = require('../services/permisos');

module.exports = function requireAdmin(req, res, next) {
  // necesita que authenticateToken ya haya puesto req.user (userId,email,role)
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Autenticación requerida' });
  }
  if (!esPersonalClinico(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Acceso denegado: se requiere rol de veterinario o administrador' });
  }
  next();
};

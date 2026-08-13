// middleware/requirePermiso.js
// Protege una ruta con un permiso de la matriz de services/permisos.js.
//
//   router.get('/reportes/resumen', authenticateToken, requirePermiso('reportes.ver'), ...)
//
// Necesita que authenticateToken haya puesto req.user antes.
const { puede, etiquetaRol } = require('../services/permisos');

module.exports = function requirePermiso(permiso) {
  return function (req, res, next) {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Autenticación requerida' });
    }
    if (!puede(req.user.role, permiso)) {
      return res.status(403).json({
        success: false,
        message: `Acceso denegado: tu rol (${etiquetaRol(req.user.role)}) no tiene permiso para esta acción`,
      });
    }
    next();
  };
};

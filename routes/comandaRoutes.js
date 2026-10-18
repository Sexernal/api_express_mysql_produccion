// routes/comandaRoutes.js
//
// Comandas (lo que se le cobra a cada consulta) y la pantalla de facturación.
//
// Cada ruta pide un permiso de la matriz de services/permisos.js en vez de
// conformarse con "está logueado". La diferencia importa: authenticateToken
// solo deja pasar a quien tiene un token válido, y los propietarios que entran
// por la app móvil TAMBIÉN tienen token. Sin el permiso, un cliente podía
// pedir /facturacion/pdf y bajarse la facturación completa de la clínica.
const express = require('express');
const router  = express.Router();
const { authenticateToken } = require('../middleware/auth');
const requirePermiso        = require('../middleware/requirePermiso');
const ComandaController     = require('../controllers/comandaController');

// Ver importes: todo el personal (super admin, veterinarios y recepción).
const puedeVer    = [authenticateToken, requirePermiso('facturacion.ver')];
// Llenar la comanda durante la consulta: solo quien atiende.
const puedeEditar = [authenticateToken, requirePermiso('comandas.editar')];
// Marcar como cobrado: todo el personal, porque lo hace recepción.
const puedeCobrar = [authenticateToken, requirePermiso('facturacion.cobrar')];

// ─── Comanda de una ficha ────────────────────────────────────────────
router.get('/fichas/:fichaId/comanda',     puedeVer,    ComandaController.getByFicha);
// Ticket descargable de una comanda: el comprobante que se le da al cliente
router.get('/fichas/:fichaId/comanda/pdf', puedeVer,    ComandaController.pdfComanda);
router.put('/fichas/:fichaId/comanda',     puedeEditar, ComandaController.saveComanda);

// ─── Pantalla de facturación ─────────────────────────────────────────
router.get('/facturacion',                 puedeVer,    ComandaController.listFacturacion);
// Mismo listado que la pantalla, pero como archivo descargable.
// Respeta los filtros aplicados y trae TODO lo que cumple el filtro.
router.get('/facturacion/pdf',             puedeVer,    ComandaController.pdfFacturacion);
router.put('/facturacion/:fichaId/cobrar', puedeCobrar, ComandaController.marcarCobrado);

module.exports = router;

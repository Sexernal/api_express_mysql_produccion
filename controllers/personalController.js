// controllers/personalController.js
//
// Gestión del personal de la clínica: ver quién es quién, corregir sus datos
// y cambiar roles. Todo aquí exige el permiso 'usuarios.gestionar', que solo
// tiene el super admin (se aplica en las rutas).
const db = require('../db');
const {
  ROLES_ASIGNABLES,
  listar,
  buscarPorId,
  verificarPasswordDe,
  validarCambioDeRol,
  registrar,
  historialDe,
  correosDeAdmins,
  correoUtilizable,
} = require('../services/personalService');
const { etiquetaRol } = require('../services/permisos');
const { isConfigured, sendMail, rolCambiadoHTML } = require('../services/emailService');

const ipDe = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || null;

const PersonalController = {

  async list(req, res) {
    try {
      res.json({ success: true, data: await listar() });
    } catch (err) {
      console.error('Error list personal:', err);
      res.status(500).json({ success: false, message: 'Error al listar el personal', error: err.message });
    }
  },

  async historial(req, res) {
    try {
      const persona = await buscarPorId(req.params.id);
      if (!persona) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
      res.json({ success: true, data: await historialDe(req.params.id) });
    } catch (err) {
      console.error('Error historial personal:', err);
      res.status(500).json({ success: false, message: 'Error al obtener el historial', error: err.message });
    }
  },

  // ─── Cambio de rol ─────────────────────────────────────────────────
  // Es la acción más delicada del sistema. Pide la contraseña del propio
  // administrador, valida las salvaguardas, registra y avisa por correo.
  async cambiarRol(req, res) {
    try {
      const actorId  = req.user.userId;
      const rolNuevo = String(req.body.role || '').trim().toLowerCase();
      const objetivo = await buscarPorId(req.params.id);

      // Primero las reglas: no tiene sentido hacer escribir la contraseña
      // para después rechazar el cambio por otro motivo.
      const errorRegla = await validarCambioDeRol({ actorId, objetivo, rolNuevo });
      if (errorRegla) return res.status(400).json({ success: false, message: errorRegla });

      // Reautenticación: prueba que es el administrador quien está al
      // teclado, y no alguien que encontró su sesión abierta.
      const errorPwd = await verificarPasswordDe(actorId, req.body.password);
      if (errorPwd) return res.status(401).json({ success: false, message: errorPwd });

      const rolAnterior = objetivo.role;
      await db.query(
        'UPDATE usuarios SET role = ?, fecha_actualizacion = NOW() WHERE id = ?',
        [rolNuevo, objetivo.id]
      );

      const actor = await buscarPorId(actorId);
      await registrar({
        usuarioId:   objetivo.id,
        actorId,
        actorNombre: actor?.nombre || null,
        accion:      'rol_cambiado',
        anterior:    rolAnterior,
        nuevo:       rolNuevo,
        ip:          ipDe(req),
      });

      // Avisos por correo. Que fallen no debe deshacer un cambio ya aplicado.
      avisarCambioDeRol({ objetivo, rolAnterior, rolNuevo, actor }).catch(err =>
        console.error('⚠️ No se pudieron enviar los avisos de cambio de rol:', err.message)
      );

      res.json({
        success: true,
        message: `${objetivo.nombre} ahora es ${etiquetaRol(rolNuevo)}`,
        data: await buscarPorId(objetivo.id),
      });
    } catch (err) {
      console.error('Error cambiarRol:', err);
      res.status(500).json({ success: false, message: 'Error al cambiar el rol', error: err.message });
    }
  },

  // ─── Corregir datos de contacto ────────────────────────────────────
  // Sobre todo para arreglar los correos de relleno @pendiente.vet: sin
  // correo real esa persona no puede restablecer su contraseña.
  async actualizarDatos(req, res) {
    try {
      const objetivo = await buscarPorId(req.params.id);
      if (!objetivo) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });

      const nombre   = req.body.nombre   !== undefined ? String(req.body.nombre).trim()   : objetivo.nombre;
      const telefono = req.body.telefono !== undefined ? String(req.body.telefono).trim() : objetivo.telefono;
      let   email    = objetivo.email;

      if (!nombre) return res.status(400).json({ success: false, message: 'El nombre no puede quedar vacío' });

      if (req.body.email !== undefined) {
        const limpio = String(req.body.email).trim().toLowerCase();
        if (!limpio) return res.status(400).json({ success: false, message: 'El correo no puede quedar vacío' });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpio))
          return res.status(400).json({ success: false, message: 'El correo no tiene un formato válido' });

        // El correo es único en la tabla: avisamos claro en vez de dejar
        // que reviente con un error de base de datos.
        if (limpio !== String(objetivo.email || '').toLowerCase()) {
          const [dup] = await db.query('SELECT id FROM usuarios WHERE email = ? AND id <> ?', [limpio, objetivo.id]);
          if (dup.length) return res.status(409).json({ success: false, message: 'Ese correo ya está en uso por otro usuario' });
        }
        email = limpio;
      }

      await db.query(
        'UPDATE usuarios SET nombre = ?, email = ?, telefono = ?, fecha_actualizacion = NOW() WHERE id = ?',
        [nombre, email, telefono || null, objetivo.id]
      );

      const actor = await buscarPorId(req.user.userId);
      // Solo se registra si el correo cambió de verdad: es el dato que
      // decide a dónde llega un restablecimiento de contraseña.
      if (String(email || '') !== String(objetivo.email || '')) {
        await registrar({
          usuarioId:   objetivo.id,
          actorId:     req.user.userId,
          actorNombre: actor?.nombre || null,
          accion:      'email_actualizado',
          anterior:    objetivo.email,
          nuevo:       email,
          ip:          ipDe(req),
        });
      }

      res.json({
        success: true,
        message: 'Datos actualizados',
        data: await buscarPorId(objetivo.id),
      });
    } catch (err) {
      console.error('Error actualizarDatos personal:', err);
      res.status(500).json({ success: false, message: 'Error al actualizar los datos', error: err.message });
    }
  },

  // Los roles que la interfaz puede ofrecer, con su etiqueta visible
  async rolesDisponibles(req, res) {
    res.json({
      success: true,
      data: ROLES_ASIGNABLES.map(r => ({ value: r, label: etiquetaRol(r) })),
    });
  },
};

// ─── Avisos por correo ───────────────────────────────────────────────
// A la persona afectada y a los demás administradores: si alguien abusara
// del permiso, el resto se entera el mismo día.
async function avisarCambioDeRol({ objetivo, rolAnterior, rolNuevo, actor }) {
  if (!isConfigured()) return;

  if (correoUtilizable(objetivo.email)) {
    await sendMail({
      to: objetivo.email,
      subject: `Tu rol en el sistema cambió a ${etiquetaRol(rolNuevo)}`,
      html: rolCambiadoHTML({
        nombre: objetivo.nombre,
        rolAnterior: etiquetaRol(rolAnterior),
        rolNuevo: etiquetaRol(rolNuevo),
        actorNombre: actor?.nombre || 'Un administrador',
        esParaElAfectado: true,
      }),
    });
  }

  for (const admin of await correosDeAdmins(actor?.id)) {
    await sendMail({
      to: admin.email,
      subject: `Cambio de rol: ${objetivo.nombre} → ${etiquetaRol(rolNuevo)}`,
      html: rolCambiadoHTML({
        nombre: objetivo.nombre,
        rolAnterior: etiquetaRol(rolAnterior),
        rolNuevo: etiquetaRol(rolNuevo),
        actorNombre: actor?.nombre || 'Un administrador',
        esParaElAfectado: false,
      }),
    });
  }
}

module.exports = PersonalController;

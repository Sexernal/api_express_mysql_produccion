// controllers/passwordResetController.js
//
// Restablecimiento de contraseña. Dos flujos sobre el mismo servicio:
//   · usuario     (doctor)      → enlace con token largo, se abre en la web
//   · propietario (cliente)     → código de 6 dígitos, se teclea en la app
//
// Ambos parten de la cédula, que es con lo que inician sesión.
const bcrypt = require('bcryptjs');
const db     = require('../db');
const {
  MINUTOS_VIGENCIA,
  PASSWORD_MIN,
  enmascararEmail,
  correoUtilizable,
  validarPassword,
  buscarPorCedula,
  emitir,
  verificar,
  consumir,
} = require('../services/passwordResetService');
const {
  isConfigured,
  sendMail,
  resetPasswordEnlaceHTML,
  resetPasswordCodigoHTML,
  passwordCambiadaHTML,
} = require('../services/emailService');

const TABLAS = { usuario: 'usuarios', propietario: 'propietarios' };

const ipDe = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || null;

// La cédula es de 9 dígitos en todo el sistema (lo valida también el login)
function cedulaValida(cedula) {
  return /^\d{9}$/.test(String(cedula || '').trim());
}

// ─── Paso 1: pedir el restablecimiento ───────────────────────────────
// Compartido por los dos flujos; solo cambia el formato del permiso y
// la plantilla del correo.
async function solicitar(req, res, { tipo, formato, plantilla, urlBase }) {
  try {
    const cedula = String(req.body.cedula || '').trim();
    if (!cedulaValida(cedula))
      return res.status(400).json({ success: false, message: 'La cédula debe tener exactamente 9 dígitos' });

    const cuenta = await buscarPorCedula(tipo, cedula);

    // Se dice claramente que no existe: es la contrapartida de mostrar la
    // pista del correo. Callarlo dejaría a la persona esperando un correo
    // que nunca va a llegar por haber tecleado mal la cédula.
    if (!cuenta)
      return res.status(404).json({ success: false, message: 'No encontramos una cuenta con esa cédula' });

    // Sin correo real no hay a dónde mandar nada. Se dice claro en vez de
    // fingir un envío que la persona esperaría en vano.
    if (!correoUtilizable(cuenta.email))
      return res.status(400).json({
        success: false,
        message: tipo === 'usuario'
          ? 'Tu cuenta no tiene un correo registrado. Pídele a un administrador que te lo agregue desde el sistema, o que restablezca tu contraseña.'
          : 'Esa cuenta no tiene un correo registrado. Contacta a la clínica para restablecer tu contraseña.',
      });

    if (!isConfigured()) {
      console.error('🔑 passwordReset: EMAIL_USER / EMAIL_APP_PASSWORD sin configurar — no se puede enviar');
      return res.status(503).json({
        success: false,
        message: 'El envío de correos no está disponible en este momento. Contacta a la clínica.',
      });
    }

    const { token, minutos, error } = await emitir({
      tipo, referenciaId: cuenta.id, formato, ip: ipDe(req),
    });
    if (error) return res.status(429).json({ success: false, message: error });

    const html = formato === 'codigo'
      ? plantilla({ nombre: cuenta.nombre, codigo: token, minutos })
      : plantilla({ nombre: cuenta.nombre, url: `${urlBase}?token=${token}`, minutos });

    try {
      await sendMail({ to: cuenta.email, subject: '🔑 Restablecer tu contraseña — Veterinaria Cañas', html });
    } catch (err) {
      console.error('🔑 Error enviando correo de restablecimiento:', err.message);
      return res.status(502).json({
        success: false,
        message: 'No se pudo enviar el correo. Inténtalo de nuevo en unos minutos.',
      });
    }

    res.json({
      success: true,
      message: 'Enviamos las instrucciones a tu correo',
      data: { email_enmascarado: enmascararEmail(cuenta.email), minutos },
    });
  } catch (err) {
    console.error('Error solicitar restablecimiento:', err);
    res.status(500).json({ success: false, message: 'Error al procesar la solicitud', error: err.message });
  }
}

// ─── Paso 2: aplicar la contraseña nueva ─────────────────────────────
async function confirmar(req, res, { tipo, token, referenciaEsperada = null }) {
  const password = req.body.password;
  const errorPwd = validarPassword(password);
  if (errorPwd) return res.status(400).json({ success: false, message: errorPwd });

  const { referenciaId, error } = await consumir({ tipo, token, referenciaEsperada });
  if (error) return res.status(400).json({ success: false, message: error });

  const hash = await bcrypt.hash(password, 10);
  await db.query(`UPDATE ${TABLAS[tipo]} SET password = ? WHERE id = ?`, [hash, referenciaId]);

  // Aviso posterior: si la persona no pidió el cambio, esta es su alarma.
  // Que falle el correo no debe deshacer un cambio que ya se aplicó.
  try {
    const [[cuenta]] = await db.query(
      `SELECT nombre, email FROM ${TABLAS[tipo]} WHERE id = ?`, [referenciaId]
    );
    if (cuenta?.email) {
      await sendMail({
        to: cuenta.email,
        subject: '✅ Tu contraseña fue cambiada — Veterinaria Cañas',
        html: passwordCambiadaHTML({ nombre: cuenta.nombre }),
      });
    }
  } catch (err) {
    console.error('🔑 No se pudo enviar el aviso de cambio:', err.message);
  }

  res.json({ success: true, message: 'Tu contraseña se cambió correctamente. Ya puedes iniciar sesión.' });
}

const PasswordResetController = {

  // ─── Doctores (web): enlace con token ──────────────────────────────

  async solicitarUsuario(req, res) {
    const base = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
    return solicitar(req, res, {
      tipo: 'usuario',
      formato: 'token',
      plantilla: resetPasswordEnlaceHTML,
      urlBase: `${base}/restablecer`,
    });
  },

  // Comprueba el token SIN gastarlo, para que la web sepa si tiene sentido
  // mostrar el formulario antes de que la persona escriba nada.
  async verificarUsuario(req, res) {
    try {
      const token = String(req.query.token || '');
      if (!token) return res.status(400).json({ success: false, message: 'Token requerido' });

      const { error } = await verificar({ tipo: 'usuario', token });
      if (error) return res.status(400).json({ success: false, message: error });

      res.json({ success: true, data: { valido: true, minutos: MINUTOS_VIGENCIA } });
    } catch (err) {
      console.error('Error verificar token:', err);
      res.status(500).json({ success: false, message: 'Error al verificar el enlace', error: err.message });
    }
  },

  async confirmarUsuario(req, res) {
    try {
      const token = String(req.body.token || '');
      if (!token) return res.status(400).json({ success: false, message: 'Token requerido' });
      return await confirmar(req, res, { tipo: 'usuario', token });
    } catch (err) {
      console.error('Error confirmar restablecimiento (usuario):', err);
      res.status(500).json({ success: false, message: 'Error al cambiar la contraseña', error: err.message });
    }
  },

  // ─── Propietarios (app): código de 6 dígitos ───────────────────────

  async solicitarPropietario(req, res) {
    return solicitar(req, res, {
      tipo: 'propietario',
      formato: 'codigo',
      plantilla: resetPasswordCodigoHTML,
    });
  },

  async confirmarPropietario(req, res) {
    try {
      const cedula = String(req.body.cedula || '').trim();
      const codigo = String(req.body.codigo || '').trim();

      if (!cedulaValida(cedula))
        return res.status(400).json({ success: false, message: 'La cédula debe tener exactamente 9 dígitos' });
      if (!/^\d{6}$/.test(codigo))
        return res.status(400).json({ success: false, message: 'El código debe tener 6 dígitos' });

      // El código se ata a la cédula: 6 dígitos sueltos no pueden servir
      // para entrar a una cuenta distinta de la que los pidió.
      const cuenta = await buscarPorCedula('propietario', cedula);
      if (!cuenta)
        return res.status(400).json({ success: false, message: 'El código no es válido o ya venció. Solicita uno nuevo.' });

      return await confirmar(req, res, {
        tipo: 'propietario',
        token: codigo,
        referenciaEsperada: cuenta.id,
      });
    } catch (err) {
      console.error('Error confirmar restablecimiento (propietario):', err);
      res.status(500).json({ success: false, message: 'Error al cambiar la contraseña', error: err.message });
    }
  },
};

module.exports = PasswordResetController;
module.exports.PASSWORD_MIN = PASSWORD_MIN;
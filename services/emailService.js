// services/emailService.js
// Envío de correos con Nodemailer + Gmail SMTP (Canal A de recordatorios).
// Requiere en .env: EMAIL_USER (cuenta Gmail) y EMAIL_APP_PASSWORD (contraseña de aplicación).
const nodemailer = require('nodemailer');

let transporter = null;

function isConfigured() {
  return Boolean(process.env.EMAIL_USER && process.env.EMAIL_APP_PASSWORD);
}

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_APP_PASSWORD,
      },
    });
  }
  return transporter;
}

async function sendMail({ to, subject, html }) {
  if (!isConfigured()) {
    console.warn('📧 emailService: EMAIL_USER / EMAIL_APP_PASSWORD no configurados — correo omitido:', subject);
    return { skipped: true };
  }
  const info = await getTransporter().sendMail({
    from: `"Veterinaria Cañas" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html,
  });
  return { messageId: info.messageId };
}

// ─── Plantilla base ───────────────────────────────────────────────────────────

function baseTemplate(titulo, contenido) {
  return `
  <div style="background:#f4f6fb;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e9f2;">
      <div style="background:#0b1220;padding:22px 28px;">
        <span style="font-size:22px;">🐾</span>
        <span style="color:#ffffff;font-size:18px;font-weight:bold;margin-left:8px;">Veterinaria Cañas</span>
      </div>
      <div style="padding:28px;">
        <h2 style="margin:0 0 16px;color:#0b1220;font-size:19px;">${titulo}</h2>
        ${contenido}
        <p style="margin:24px 0 0;color:#6b7280;font-size:12px;line-height:1.6;">
          Este es un mensaje automático de Veterinaria Cañas. Si tienes dudas o necesitas
          reprogramar, contáctanos por teléfono o visítanos en la clínica.
        </p>
      </div>
    </div>
  </div>`;
}

function filaDato(label, valor) {
  return `
    <tr>
      <td style="padding:8px 0;color:#6b7280;font-size:13px;width:150px;">${label}</td>
      <td style="padding:8px 0;color:#111827;font-size:14px;font-weight:bold;">${valor}</td>
    </tr>`;
}

// ─── Recordatorio de cita (24 h antes) ────────────────────────────────────────

function recordatorioCitaHTML(cita) {
  const fecha = new Date(cita.fecha_inicio);
  const fechaStr = fecha.toLocaleDateString('es-CR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const horaStr  = fecha.toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' });
  const contenido = `
    <p style="margin:0 0 18px;color:#374151;font-size:14px;line-height:1.6;">
      Hola <strong>${cita.propietario_nombre || ''}</strong>, te recordamos que
      <strong>${cita.mascota_nombre || 'tu mascota'}</strong> tiene una cita programada
      para mañana:
    </p>
    <table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;padding:8px;">
      ${filaDato('📆 Fecha',    fechaStr)}
      ${filaDato('🕐 Hora',     horaStr)}
      ${filaDato('🩺 Consulta', cita.tipo_consulta || 'Consulta general')}
      ${cita.veterinario_nombre ? filaDato('👨‍⚕️ Veterinario', `Dr. ${cita.veterinario_nombre}`) : ''}
    </table>
    <p style="margin:18px 0 0;color:#374151;font-size:14px;">¡Te esperamos! 🐾</p>`;
  return baseTemplate('⏰ Recordatorio de cita', contenido);
}

// ─── Recordatorio de vacuna (30 días antes) ───────────────────────────────────

function recordatorioVacunaHTML(vacuna) {
  const [y, m, d] = String(vacuna.fecha_proxima).slice(0, 10).split('-');
  const fechaStr = `${d}/${m}/${y}`;
  const contenido = `
    <p style="margin:0 0 18px;color:#374151;font-size:14px;line-height:1.6;">
      Hola <strong>${vacuna.propietario_nombre || ''}</strong>, la próxima dosis de la vacuna de
      <strong>${vacuna.mascota_nombre || 'tu mascota'}</strong> está por vencer:
    </p>
    <table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;padding:8px;">
      ${filaDato('💉 Vacuna',        vacuna.nombre_vacuna || '—')}
      ${filaDato('📅 Fecha límite',  fechaStr)}
      ${vacuna.producto ? filaDato('🧪 Producto', vacuna.producto) : ''}
    </table>
    <p style="margin:18px 0 0;color:#374151;font-size:14px;line-height:1.6;">
      Agenda una cita de vacunación desde la app o llamando a la clínica para mantener
      al día el libro de vacunas de tu mascota. 🐾
    </p>`;
  return baseTemplate('💉 Recordatorio de vacunación', contenido);
}

// ─── Restablecer contraseña — enlace (doctores, desde la web) ─────────────────

function resetPasswordEnlaceHTML({ nombre, url, minutos }) {
  const contenido = `
    <p style="margin:0 0 18px;color:#374151;font-size:14px;line-height:1.6;">
      Hola <strong>${nombre || ''}</strong>, recibimos una solicitud para restablecer
      la contraseña de tu cuenta del sistema veterinario.
    </p>
    <p style="margin:0 0 22px;color:#374151;font-size:14px;line-height:1.6;">
      Pulsa el botón para crear una contraseña nueva. El enlace vence en
      <strong>${minutos} minutos</strong> y solo funciona una vez.
    </p>
    <table style="margin:0 auto 22px;"><tr><td style="border-radius:8px;background:#2563eb;">
      <a href="${url}" style="display:inline-block;padding:13px 30px;color:#ffffff;
         text-decoration:none;font-size:15px;font-weight:bold;border-radius:8px;">
        Cambiar mi contraseña
      </a>
    </td></tr></table>
    <p style="margin:0 0 8px;color:#6b7280;font-size:12px;line-height:1.6;">
      Si el botón no funciona, copia y pega esta dirección en tu navegador:
    </p>
    <p style="margin:0 0 20px;word-break:break-all;font-size:12px;">
      <a href="${url}" style="color:#2563eb;">${url}</a>
    </p>
    <div style="padding:14px 16px;background:#fef3c7;border-left:3px solid #f59e0b;border-radius:6px;">
      <p style="margin:0;color:#78350f;font-size:13px;line-height:1.6;">
        <strong>¿No fuiste tú?</strong> Ignora este mensaje: tu contraseña actual
        sigue funcionando y nadie puede cambiarla sin este enlace.
      </p>
    </div>`;
  return baseTemplate('🔑 Restablecer tu contraseña', contenido);
}

// ─── Restablecer contraseña — código (propietarios, desde la app) ─────────────

function resetPasswordCodigoHTML({ nombre, codigo, minutos }) {
  const digitos = String(codigo).split('').map(d => `
    <td style="padding:0 4px;">
      <div style="width:38px;height:48px;line-height:48px;text-align:center;
                  background:#f3f4f6;border:1px solid #e5e7eb;border-radius:8px;
                  font-size:24px;font-weight:bold;color:#0b1220;
                  font-family:'Courier New',monospace;">${d}</div>
    </td>`).join('');

  const contenido = `
    <p style="margin:0 0 18px;color:#374151;font-size:14px;line-height:1.6;">
      Hola <strong>${nombre || ''}</strong>, recibimos una solicitud para restablecer
      la contraseña de tu cuenta en la app de Veterinaria Cañas.
    </p>
    <p style="margin:0 0 18px;color:#374151;font-size:14px;line-height:1.6;">
      Escribe este código en la aplicación:
    </p>
    <table style="margin:0 auto 18px;border-collapse:collapse;"><tr>${digitos}</tr></table>
    <p style="margin:0 0 20px;text-align:center;color:#6b7280;font-size:13px;">
      Vence en <strong>${minutos} minutos</strong> y solo funciona una vez.
    </p>
    <div style="padding:14px 16px;background:#fef3c7;border-left:3px solid #f59e0b;border-radius:6px;">
      <p style="margin:0;color:#78350f;font-size:13px;line-height:1.6;">
        <strong>¿No fuiste tú?</strong> Ignora este mensaje y no compartas el código
        con nadie. Tu contraseña actual sigue funcionando.
      </p>
    </div>`;
  return baseTemplate('🔑 Código para restablecer tu contraseña', contenido);
}

// ─── Aviso de contraseña cambiada ─────────────────────────────────────────────
// Se manda DESPUÉS del cambio. Si la persona no lo hizo, es su señal de alarma.

function passwordCambiadaHTML({ nombre }) {
  const contenido = `
    <p style="margin:0 0 18px;color:#374151;font-size:14px;line-height:1.6;">
      Hola <strong>${nombre || ''}</strong>, tu contraseña se cambió correctamente.
      Ya puedes iniciar sesión con la nueva.
    </p>
    <div style="padding:14px 16px;background:#fee2e2;border-left:3px solid #ef4444;border-radius:6px;">
      <p style="margin:0;color:#7f1d1d;font-size:13px;line-height:1.6;">
        <strong>¿No fuiste tú?</strong> Contacta a la clínica de inmediato: alguien
        más pudo haber accedido a tu correo.
      </p>
    </div>`;
  return baseTemplate('✅ Tu contraseña fue cambiada', contenido);
}

// ─── Aviso de cambio de rol ───────────────────────────────────────────────────
// Se manda a la persona afectada y a los demás administradores. Si alguien
// abusara del permiso de ascender, el resto se entera el mismo día.

function rolCambiadoHTML({ nombre, rolAnterior, rolNuevo, actorNombre, esParaElAfectado }) {
  const esAscenso = rolNuevo === 'Administrador';

  const cuerpo = esParaElAfectado
    ? `<p style="margin:0 0 18px;color:#374151;font-size:14px;line-height:1.6;">
         Hola <strong>${nombre || ''}</strong>, tu rol en el sistema de Veterinaria Cañas
         fue actualizado por <strong>${actorNombre}</strong>.
       </p>`
    : `<p style="margin:0 0 18px;color:#374151;font-size:14px;line-height:1.6;">
         <strong>${actorNombre}</strong> cambió el rol de <strong>${nombre || ''}</strong>
         en el sistema. Recibes este aviso porque también eres administrador.
       </p>`;

  const contenido = `
    ${cuerpo}
    <table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;padding:8px;">
      ${filaDato('Rol anterior', rolAnterior)}
      ${filaDato('Rol nuevo',    rolNuevo)}
    </table>
    ${esAscenso ? `
      <div style="margin-top:18px;padding:14px 16px;background:#eff6ff;border-left:3px solid #3b82f6;border-radius:6px;">
        <p style="margin:0;color:#1e3a8a;font-size:13px;line-height:1.6;">
          El rol de <strong>Administrador</strong> da acceso completo: reportes,
          catálogo de precios y gestión del personal.
        </p>
      </div>` : ''}
    <div style="margin-top:18px;padding:14px 16px;background:#fef3c7;border-left:3px solid #f59e0b;border-radius:6px;">
      <p style="margin:0;color:#78350f;font-size:13px;line-height:1.6;">
        <strong>¿No esperabas este cambio?</strong> Contacta de inmediato a la
        administración de la clínica.
      </p>
    </div>`;

  return baseTemplate(
    esAscenso ? '⬆️ Cambio de rol en el sistema' : '🔄 Cambio de rol en el sistema',
    contenido
  );
}

module.exports = {
  isConfigured,
  sendMail,
  recordatorioCitaHTML,
  recordatorioVacunaHTML,
  resetPasswordEnlaceHTML,
  resetPasswordCodigoHTML,
  passwordCambiadaHTML,
  rolCambiadoHTML,
};

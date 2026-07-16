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

module.exports = { isConfigured, sendMail, recordatorioCitaHTML, recordatorioVacunaHTML };

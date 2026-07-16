// jobs/recordatoriosJob.js
// Tarea programada (Canal A del plan de mejoras):
//  - Cada 30 min: busca citas en las próximas 24 h y envía recordatorio por email.
//  - Cada día a las 8:00 am: busca vacunas que vencen en los próximos 30 días y envía recordatorio.
// La tabla recordatorios_enviados evita enviar el mismo recordatorio dos veces
// (clave única tipo + referencia + fecha objetivo; si una cita se reprograma,
// cambia la fecha objetivo y se envía un nuevo recordatorio).
const cron = require('node-cron');
const db = require('../db');
const { isConfigured, sendMail, recordatorioCitaHTML, recordatorioVacunaHTML } = require('../services/emailService');

async function yaEnviado(tipo, referenciaId, fechaObjetivo) {
  const [rows] = await db.query(
    'SELECT id FROM recordatorios_enviados WHERE tipo = ? AND referencia_id = ? AND fecha_objetivo = ?',
    [tipo, referenciaId, fechaObjetivo]
  );
  return rows.length > 0;
}

async function marcarEnviado(tipo, referenciaId, fechaObjetivo) {
  await db.query(
    'INSERT IGNORE INTO recordatorios_enviados (tipo, referencia_id, fecha_objetivo) VALUES (?, ?, ?)',
    [tipo, referenciaId, fechaObjetivo]
  );
}

// ─── Recordatorios de citas (24 h antes) ──────────────────────────────────────

async function procesarCitas() {
  try {
    const [citas] = await db.query(
      `SELECT c.id, c.fecha_inicio, c.tipo_consulta, c.estado,
              m.nombre AS mascota_nombre,
              p.nombre AS propietario_nombre, p.email AS propietario_email,
              u.nombre AS veterinario_nombre
       FROM citas c
       LEFT JOIN mascotas m     ON c.mascota_id     = m.id
       LEFT JOIN propietarios p ON c.propietario_id = p.id
       LEFT JOIN usuarios u     ON c.veterinario_id = u.id
       WHERE c.fecha_inicio BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 24 HOUR)
         AND LOWER(c.estado) IN ('pendiente', 'confirmada')`
    );

    for (const cita of citas) {
      if (!cita.propietario_email) continue;
      if (await yaEnviado('cita', cita.id, cita.fecha_inicio)) continue;

      try {
        const r = await sendMail({
          to: cita.propietario_email,
          subject: `⏰ Recordatorio: cita de ${cita.mascota_nombre || 'tu mascota'} mañana`,
          html: recordatorioCitaHTML(cita),
        });
        if (!r.skipped) {
          await marcarEnviado('cita', cita.id, cita.fecha_inicio);
          console.log(`📧 Recordatorio de cita #${cita.id} enviado a ${cita.propietario_email}`);
        }
      } catch (err) {
        console.error(`📧 Error enviando recordatorio de cita #${cita.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('Recordatorios de citas — error:', err.message);
  }
}

// ─── Recordatorios de vacunas (vencen en ≤ 30 días) ───────────────────────────

async function procesarVacunas() {
  try {
    const [vacunas] = await db.query(
      `SELECT v.id, v.nombre_vacuna, v.producto, v.fecha_proxima,
              m.nombre AS mascota_nombre,
              p.nombre AS propietario_nombre, p.email AS propietario_email
       FROM vacunas v
       LEFT JOIN mascotas m     ON v.mascota_id = m.id
       LEFT JOIN propietarios p ON m.owner_id   = p.id
       WHERE v.ciclo_completado = 0
         AND v.fecha_proxima IS NOT NULL
         AND v.fecha_proxima BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)`
    );

    for (const vacuna of vacunas) {
      if (!vacuna.propietario_email) continue;
      if (await yaEnviado('vacuna', vacuna.id, vacuna.fecha_proxima)) continue;

      try {
        const r = await sendMail({
          to: vacuna.propietario_email,
          subject: `💉 Recordatorio: vacuna de ${vacuna.mascota_nombre || 'tu mascota'} próxima a vencer`,
          html: recordatorioVacunaHTML(vacuna),
        });
        if (!r.skipped) {
          await marcarEnviado('vacuna', vacuna.id, vacuna.fecha_proxima);
          console.log(`📧 Recordatorio de vacuna #${vacuna.id} enviado a ${vacuna.propietario_email}`);
        }
      } catch (err) {
        console.error(`📧 Error enviando recordatorio de vacuna #${vacuna.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('Recordatorios de vacunas — error:', err.message);
  }
}

// ─── Arranque ─────────────────────────────────────────────────────────────────

function start() {
  if (!isConfigured()) {
    console.warn('📧 Recordatorios: EMAIL_USER / EMAIL_APP_PASSWORD no configurados. El sistema corre igual pero NO se enviarán correos.');
  }

  // Citas: cada 30 minutos
  cron.schedule('*/30 * * * *', procesarCitas);
  // Vacunas: todos los días a las 8:00 am
  cron.schedule('0 8 * * *', procesarVacunas);

  // Pasada inicial 15 s después de arrancar (útil para probar; el dedupe evita repetidos)
  setTimeout(() => { procesarCitas(); procesarVacunas(); }, 15000);

  console.log('⏰ Recordatorios programados: citas cada 30 min, vacunas 8:00 am');
}

module.exports = { start, procesarCitas, procesarVacunas };

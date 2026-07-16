// controllers/notificacionesController.js
// Notificaciones para el personal del sistema web (admin y recepcionistas):
//  - Citas dentro de las próximas 24 horas.
//  - Vacunas que vencen en ≤ 30 días o ya vencidas (ciclo no completado).
// Cada ítem lleva una key estable para que el frontend pueda marcar leídos.
const db = require('../db');

function displayYMD(val) {
  const m = String(val).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

const NotificacionesController = {

  // GET /notificaciones
  async list(req, res) {
    try {
      const [citas] = await db.query(
        `SELECT c.id, c.fecha_inicio, c.tipo_consulta, c.estado,
                m.nombre AS mascota_nombre,
                p.nombre AS propietario_nombre,
                u.nombre AS veterinario_nombre
         FROM citas c
         LEFT JOIN mascotas m     ON c.mascota_id     = m.id
         LEFT JOIN propietarios p ON c.propietario_id = p.id
         LEFT JOIN usuarios u     ON c.veterinario_id = u.id
         WHERE c.fecha_inicio BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 24 HOUR)
           AND LOWER(c.estado) IN ('pendiente', 'confirmada')
         ORDER BY c.fecha_inicio ASC`
      );

      const [vacunas] = await db.query(
        `SELECT v.id, v.nombre_vacuna, v.fecha_proxima,
                DATEDIFF(v.fecha_proxima, CURDATE()) AS dias_restantes,
                m.nombre AS mascota_nombre,
                p.nombre AS propietario_nombre
         FROM vacunas v
         LEFT JOIN mascotas m     ON v.mascota_id = m.id
         LEFT JOIN propietarios p ON m.owner_id   = p.id
         WHERE v.ciclo_completado = 0
           AND v.fecha_proxima IS NOT NULL
           AND v.fecha_proxima <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
         ORDER BY v.fecha_proxima ASC`
      );

      const items = [
        ...citas.map(c => ({
          key: `cita-${c.id}-${new Date(c.fecha_inicio).getTime()}`,
          tipo: 'cita',
          fecha_inicio: c.fecha_inicio,
          tipo_consulta: c.tipo_consulta,
          estado: (c.estado || '').toLowerCase(),
          mascota_nombre: c.mascota_nombre,
          propietario_nombre: c.propietario_nombre,
          veterinario_nombre: c.veterinario_nombre,
        })),
        ...vacunas.map(v => ({
          key: `vacuna-${v.id}-${String(v.fecha_proxima).slice(0, 10)}`,
          tipo: 'vacuna',
          nombre_vacuna: v.nombre_vacuna,
          fecha_proxima: String(v.fecha_proxima).slice(0, 10),
          fecha_proxima_display: displayYMD(v.fecha_proxima) || '—',
          dias_restantes: v.dias_restantes,
          estado: v.dias_restantes < 0 ? 'vencida' : 'proxima',
          mascota_nombre: v.mascota_nombre,
          propietario_nombre: v.propietario_nombre,
        })),
      ];

      res.json({ success: true, data: { items, total: items.length } });
    } catch (err) {
      console.error('Error listando notificaciones:', err);
      res.status(500).json({ success: false, message: 'Error al obtener notificaciones', error: err.message });
    }
  },
};

module.exports = NotificacionesController;

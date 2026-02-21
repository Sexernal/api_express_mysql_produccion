// controllers/citasController.js
const db = require('../db');
const { validationResult } = require('express-validator');

/**
 * CitasController - incluye:
 *  - control de solapamientos por veterinario
 *  - buffer opcional (buffer_min) para tiempo de preparación después de la cita
 *  - endpoints para confirmar y marcar completada
 */

function parseDate(val) {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * _hasOverlap:
 *   Verifica si existe solapamiento con otras citas del mismo veterinario.
 *   Se considera buffer (minutos) adicional al final de cada cita.
 *
 *   Lógica: nueva_start < (existing_end + buffer)  AND existing_start < (new_end + buffer)
 *
 *   Parámetros:
 *     veterinario_id - id veterinario
 *     fecha_inicio - string SQL "YYYY-MM-DD HH:MM:SS" (nueva cita start)
 *     duracion_min - duración de la nueva cita en minutos
 *     excludeId - opcional id a excluir (para update)
 *     bufferMin - minutos de buffer (opcional, default 10)
 */
async function _hasOverlap(veterinario_id, fecha_inicio, duracion_min, excludeId = null, bufferMin = 10) {
  if (!veterinario_id) return false;
  // Usamos DATE_ADD anidados para sumar duracion + buffer
  // existing_end_plus_buffer = DATE_ADD(DATE_ADD(c.fecha_inicio, INTERVAL c.duracion_min MINUTE), INTERVAL ? MINUTE)
  // new_end_plus_buffer = DATE_ADD(DATE_ADD(?, INTERVAL ? MINUTE), INTERVAL ? MINUTE) -> start + duracion + buffer
  let sql = `
    SELECT 1 FROM citas c
    WHERE c.veterinario_id = ?
      AND (? < DATE_ADD(DATE_ADD(c.fecha_inicio, INTERVAL c.duracion_min MINUTE), INTERVAL ? MINUTE))
      AND (c.fecha_inicio < DATE_ADD(DATE_ADD(?, INTERVAL ? MINUTE), INTERVAL ? MINUTE))
  `;
  const params = [veterinario_id, fecha_inicio, bufferMin, fecha_inicio, duracion_min, bufferMin];
  if (excludeId) {
    sql += ` AND c.id != ?`;
    params.push(excludeId);
  }
  sql += ` LIMIT 1`;
  const [rows] = await db.query(sql, params);
  return rows.length > 0;
}

const CitasController = {
  // GET /citas
  async list(req, res) {
    try {
      const page = Math.max(1, parseInt(req.query.page || 1));
      const limit = Math.min(200, parseInt(req.query.limit || 50));
      const offset = (page - 1) * limit;

      const filters = [];
      const params = [];

      if (req.query.mascota_id) { filters.push('c.mascota_id = ?'); params.push(req.query.mascota_id); }
      if (req.query.propietario_id) { filters.push('c.propietario_id = ?'); params.push(req.query.propietario_id); }
      if (req.query.veterinario_id) { filters.push('c.veterinario_id = ?'); params.push(req.query.veterinario_id); }
      if (req.query.desde) { filters.push('c.fecha_inicio >= ?'); params.push(req.query.desde); }
      if (req.query.hasta) { filters.push('c.fecha_inicio <= ?'); params.push(req.query.hasta); }

      const where = filters.length ? 'WHERE ' + filters.join(' AND ') : '';

      const countSql = `SELECT COUNT(*) AS total FROM citas c ${where}`;
      const [countRows] = await db.query(countSql, params);
      const total = countRows[0]?.total || 0;

      const sql = `
        SELECT c.*,
               m.nombre AS mascota_nombre,
               p.nombre AS propietario_nombre,
               u.nombre AS veterinario_nombre
        FROM citas c
        LEFT JOIN mascotas m ON c.mascota_id = m.id
        LEFT JOIN propietarios p ON c.propietario_id = p.id
        LEFT JOIN usuarios u ON c.veterinario_id = u.id
        ${where}
        ORDER BY c.fecha_inicio DESC
        LIMIT ? OFFSET ?
      `;
      const [rows] = await db.query(sql, [...params, limit, offset]);

      res.set('X-Total-Count', String(total));
      res.json({ success: true, data: rows, meta: { total, page, limit } });
    } catch (err) {
      console.error('Error list citas:', err);
      res.status(500).json({ success: false, message: 'Error al listar citas', error: err.message });
    }
  },

  // GET /citas/:id
  async getById(req, res) {
    try {
      const id = req.params.id;
      const [rows] = await db.query(`
        SELECT c.*, m.nombre AS mascota_nombre, p.nombre AS propietario_nombre, u.nombre AS veterinario_nombre
        FROM citas c
        LEFT JOIN mascotas m ON c.mascota_id = m.id
        LEFT JOIN propietarios p ON c.propietario_id = p.id
        LEFT JOIN usuarios u ON c.veterinario_id = u.id
        WHERE c.id = ?`, [id]);
      if (!rows.length) return res.status(404).json({ success: false, message: 'Cita no encontrada' });
      res.json({ success: true, data: rows[0] });
    } catch (err) {
      console.error('Error get cita:', err);
      res.status(500).json({ success: false, message: 'Error al obtener cita', error: err.message });
    }
  },

  // POST /citas
  async create(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Errores de validación', errors: errors.array() });
      }

      const { mascota_id, propietario_id, veterinario_id, tipo_consulta, motivo, fecha_inicio, duracion_min } = req.body;

      if (!mascota_id || !propietario_id || !fecha_inicio) {
        return res.status(400).json({ success: false, message: 'mascota_id, propietario_id y fecha_inicio son requeridos' });
      }

      // validar mascota y pertenencia
      const [mrows] = await db.query('SELECT id, owner_id FROM mascotas WHERE id = ?', [mascota_id]);
      if (!mrows.length) return res.status(400).json({ success: false, message: 'Mascota no existe' });
      const m = mrows[0];
      const mascotaOwnerId = m.owner_id || m.propietario_id;
      if (Number(mascotaOwnerId) !== Number(propietario_id)) {
        return res.status(400).json({ success: false, message: 'La mascota no pertenece al propietario indicado' });
      }

      // permisos: si quien crea es propietario, asegurar coincide
      if (req.user.role === 'propietario' && Number(req.user.userId) !== Number(propietario_id)) {
        return res.status(403).json({ success: false, message: 'No autorizado para crear cita para otro propietario' });
      }

      // validar veterinario si se pasó (por ahora: veterinario = usuario con role 'admin' en tu esquema)
      let vetIdToUse = null;
      if (veterinario_id) {
        const [urows] = await db.query('SELECT id, role FROM usuarios WHERE id = ?', [veterinario_id]);
        if (!urows.length) return res.status(400).json({ success: false, message: 'Veterinario no encontrado' });
        if ((urows[0].role || '').toLowerCase() !== 'admin') {
          return res.status(400).json({ success: false, message: 'El usuario seleccionado no es un veterinario (role admin)' });
        }
        vetIdToUse = Number(veterinario_id);
      }

      const fecha = parseDate(fecha_inicio);
      if (!fecha) return res.status(400).json({ success: false, message: 'fecha_inicio inválida' });

      const durMin = typeof duracion_min !== 'undefined' && duracion_min !== null ? Number(duracion_min) : 30;
      if (isNaN(durMin) || durMin <= 0) return res.status(400).json({ success: false, message: 'duracion_min inválida' });

      // buffer opcional: desde body buffer_min (en minutos) o default 10
      const bufferMin = Number(req.body.buffer_min ?? req.body.bufferMin ?? 10);

      // comprobar solapamientos si hay veterinario asignado
      if (vetIdToUse) {
        const hasOverlap = await _hasOverlap(vetIdToUse, fecha.toISOString().slice(0,19).replace('T',' '), durMin, null, bufferMin);
        if (hasOverlap) {
          return res.status(409).json({ success: false, message: 'Conflicto: el veterinario tiene otra cita en ese horario (considerando buffer)' });
        }
      }

      // insertar
      const createdBy = req.user?.userId || null;
      const insertSql = `INSERT INTO citas (mascota_id, propietario_id, veterinario_id, tipo_consulta, motivo, fecha_inicio, duracion_min, estado, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      const insertParams = [mascota_id, propietario_id, vetIdToUse, tipo_consulta || 'consulta general', motivo || null, formatDateToSQL(fecha), durMin, 'pendiente', createdBy];
      const [result] = await db.query(insertSql, insertParams);

      // devolver cita creada
      const [rows] = await db.query(`
        SELECT c.*, m.nombre AS mascota_nombre, p.nombre AS propietario_nombre, u.nombre AS veterinario_nombre
        FROM citas c
        LEFT JOIN mascotas m ON c.mascota_id = m.id
        LEFT JOIN propietarios p ON c.propietario_id = p.id
        LEFT JOIN usuarios u ON c.veterinario_id = u.id
        WHERE c.id = ?`, [result.insertId]);

      res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      console.error('Error create cita:', err);
      res.status(500).json({ success: false, message: 'Error al crear cita', error: err.message });
    }
  },

  // PUT /citas/:id
  async update(req, res) {
    try {
      const id = req.params.id;
      const [existingRows] = await db.query('SELECT * FROM citas WHERE id = ?', [id]);
      if (!existingRows.length) return res.status(404).json({ success: false, message: 'Cita no encontrada' });
      const existing = existingRows[0];

      // permisos
      const userRole = req.user.role;
      const userId = req.user.userId;
      if (userRole === 'propietario' && Number(userId) !== Number(existing.propietario_id)) {
        return res.status(403).json({ success: false, message: 'No autorizado para editar esta cita' });
      }

      const { mascota_id, propietario_id, veterinario_id, tipo_consulta, motivo, fecha_inicio, duracion_min, estado } = req.body;

      // validar mascota/propietario coherencia si cambian
      if (mascota_id || propietario_id) {
        const mId = mascota_id || existing.mascota_id;
        const pId = propietario_id || existing.propietario_id;
        const [mrows] = await db.query('SELECT owner_id FROM mascotas WHERE id = ?', [mId]);
        if (!mrows.length) return res.status(400).json({ success: false, message: 'Mascota no existe' });
        const ownerId = mrows[0].owner_id;
        if (Number(ownerId) !== Number(pId)) return res.status(400).json({ success: false, message: 'La mascota no pertenece al propietario indicado' });
      }

      // validar veterinario (si viene)
      let vetToUse = existing.veterinario_id;
      if (typeof veterinario_id !== 'undefined') {
        if (veterinario_id === null || veterinario_id === '') {
          vetToUse = null;
        } else {
          const [urows] = await db.query('SELECT id, role FROM usuarios WHERE id = ?', [veterinario_id]);
          if (!urows.length) return res.status(400).json({ success: false, message: 'Veterinario no encontrado' });
          if ((urows[0].role || '').toLowerCase() !== 'admin') {
            return res.status(400).json({ success: false, message: 'El usuario seleccionado no es un veterinario (role admin)' });
          }
          vetToUse = Number(veterinario_id);
        }
      }

      const fecha = fecha_inicio ? parseDate(fecha_inicio) : (existing.fecha_inicio ? new Date(existing.fecha_inicio) : null);
      if (!fecha) return res.status(400).json({ success: false, message: 'fecha_inicio inválida' });

      const durMin = (typeof duracion_min !== 'undefined' && duracion_min !== null) ? Number(duracion_min) : existing.duracion_min;
      if (isNaN(durMin) || durMin <= 0) return res.status(400).json({ success: false, message: 'duracion_min inválida' });

      // buffer opcional
      const bufferMin = Number(req.body.buffer_min ?? req.body.bufferMin ?? 10);

      // comprobar solapamientos si vetToUse
      if (vetToUse) {
        const hasOverlap = await _hasOverlap(vetToUse, fecha.toISOString().slice(0,19).replace('T',' '), durMin, id, bufferMin);
        if (hasOverlap) {
          return res.status(409).json({ success: false, message: 'Conflicto: el veterinario tiene otra cita en ese horario (considerando buffer)' });
        }
      }

      // actualizar
      await db.query(
        `UPDATE citas SET
           mascota_id = COALESCE(?, mascota_id),
           propietario_id = COALESCE(?, propietario_id),
           veterinario_id = ?,
           tipo_consulta = COALESCE(?, tipo_consulta),
           motivo = COALESCE(?, motivo),
           fecha_inicio = ?,
           duracion_min = COALESCE(?, duracion_min),
           estado = COALESCE(?, estado),
           updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          mascota_id || null,
          propietario_id || null,
          vetToUse,
          tipo_consulta || null,
          motivo || null,
          formatDateToSQL(fecha),
          durMin,
          estado || null,
          id
        ]
      );

      const [rows] = await db.query(`
        SELECT c.*, m.nombre AS mascota_nombre, p.nombre AS propietario_nombre, u.nombre AS veterinario_nombre
        FROM citas c
        LEFT JOIN mascotas m ON c.mascota_id = m.id
        LEFT JOIN propietarios p ON c.propietario_id = p.id
        LEFT JOIN usuarios u ON c.veterinario_id = u.id
        WHERE c.id = ?`, [id]);

      res.json({ success: true, data: rows[0] });
    } catch (err) {
      console.error('Error update cita:', err);
      res.status(500).json({ success: false, message: 'Error al actualizar cita', error: err.message });
    }
  },

  // POST /citas/:id/confirm
  async confirm(req, res) {
    try {
      const id = req.params.id;
      const [rows] = await db.query('SELECT * FROM citas WHERE id = ?', [id]);
      if (!rows.length) return res.status(404).json({ success: false, message: 'Cita no encontrada' });
      const cita = rows[0];

      // permisos: admin o propietario dueño
      if (req.user.role !== 'admin') {
        if (req.user.role === 'propietario' && Number(req.user.userId) === Number(cita.propietario_id)) {
          // ok
        } else {
          return res.status(403).json({ success: false, message: 'No autorizado para confirmar esta cita' });
        }
      }

      await db.query('UPDATE citas SET estado = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['confirmada', id]);

      // devolver cita actualizada
      const [r2] = await db.query(`
        SELECT c.*, m.nombre AS mascota_nombre, p.nombre AS propietario_nombre, u.nombre AS veterinario_nombre
        FROM citas c
        LEFT JOIN mascotas m ON c.mascota_id = m.id
        LEFT JOIN propietarios p ON c.propietario_id = p.id
        LEFT JOIN usuarios u ON c.veterinario_id = u.id
        WHERE c.id = ?`, [id]);

      res.json({ success: true, data: r2[0] });
    } catch (err) {
      console.error('Error confirm cita:', err);
      res.status(500).json({ success: false, message: 'Error al confirmar cita', error: err.message });
    }
  },

  // POST /citas/:id/complete
  async complete(req, res) {
    try {
      const id = req.params.id;
      const [rows] = await db.query('SELECT * FROM citas WHERE id = ?', [id]);
      if (!rows.length) return res.status(404).json({ success: false, message: 'Cita no encontrada' });
      const cita = rows[0];

      // permisos: admin o propietario dueño
      if (req.user.role !== 'admin') {
        if (req.user.role === 'propietario' && Number(req.user.userId) === Number(cita.propietario_id)) {
          // ok
        } else {
          return res.status(403).json({ success: false, message: 'No autorizado para marcar completada esta cita' });
        }
      }

      await db.query('UPDATE citas SET estado = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['completada', id]);

      const [r2] = await db.query(`
        SELECT c.*, m.nombre AS mascota_nombre, p.nombre AS propietario_nombre, u.nombre AS veterinario_nombre
        FROM citas c
        LEFT JOIN mascotas m ON c.mascota_id = m.id
        LEFT JOIN propietarios p ON c.propietario_id = p.id
        LEFT JOIN usuarios u ON c.veterinario_id = u.id
        WHERE c.id = ?`, [id]);

      res.json({ success: true, data: r2[0] });
    } catch (err) {
      console.error('Error complete cita:', err);
      res.status(500).json({ success: false, message: 'Error al marcar completada', error: err.message });
    }
  },

  // DELETE /citas/:id
  async remove(req, res) {
    try {
      const id = req.params.id;
      const [rows] = await db.query('SELECT * FROM citas WHERE id = ?', [id]);
      if (!rows.length) return res.status(404).json({ success: false, message: 'Cita no encontrada' });
      const cita = rows[0];

      // permisos: admin o propietario dueño pueden borrar
      if (req.user.role !== 'admin') {
        if (req.user.role === 'propietario' && Number(req.user.userId) === Number(cita.propietario_id)) {
          // ok
        } else {
          return res.status(403).json({ success: false, message: 'No autorizado para eliminar esta cita' });
        }
      }

      await db.query('DELETE FROM citas WHERE id = ?', [id]);
      res.json({ success: true, message: 'Cita eliminada' });
    } catch (err) {
      console.error('Error delete cita:', err);
      res.status(500).json({ success: false, message: 'Error al eliminar cita', error: err.message });
    }
  }
};

// util helpers
function formatDateToSQL(dt) {
  const pad = n => String(n).padStart(2, '0');
  const yyyy = dt.getFullYear();
  const mm = pad(dt.getMonth() + 1);
  const dd = pad(dt.getDate());
  const hh = pad(dt.getHours());
  const mi = pad(dt.getMinutes());
  const ss = pad(dt.getSeconds());
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function veterinarian_idOrNumber(v) {
  return (v === null || v === '') ? null : Number(v);
}

module.exports = CitasController;
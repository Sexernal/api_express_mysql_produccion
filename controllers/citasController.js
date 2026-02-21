// controllers/citasController.js
const db = require('../db');
const { validationResult } = require('express-validator');

/**
 * Reglas:
 * - authenticated routes (authenticateToken) ponen req.user = { userId, email, role }
 * - propietarios (role === 'propietario') pueden crear citas para sí mismos (propietario_id debe coincidir),
 *   pueden proponer veterinario_id (se valida que exista y sea admin).
 * - admins pueden crear/editar/elimnar cualquier cita.
 * - se valida solapamientos por veterinario: si hay citas solapadas para mismo veterinario -> 409.
 */

function parseDate(val) {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function addMinutesSql(fechaField, minutes) {
  // used in SQL for comparisons: DATE_ADD(fecha_inicio, INTERVAL duracion_min MINUTE)
  return `DATE_ADD(${fechaField}, INTERVAL ${minutes} MINUTE)`;
}

const CitasController = {
  // GET /citas  (lista, con filtros: mascota_id, propietario_id, veterinario_id, desde, hasta, page, limit)
  async list(req, res) {
    try {
      const page = Math.max(1, parseInt(req.query.page || 1));
      const limit = Math.min(200, parseInt(req.query.limit || 50));
      const offset = (page - 1) * limit;

      const filters = [];
      const params = [];

      if (req.query.mascota_id) {
        filters.push('c.mascota_id = ?');
        params.push(req.query.mascota_id);
      }
      if (req.query.propietario_id) {
        filters.push('c.propietario_id = ?');
        params.push(req.query.propietario_id);
      }
      if (req.query.veterinario_id) {
        filters.push('c.veterinario_id = ?');
        params.push(req.query.veterinario_id);
      }
      if (req.query.desde) {
        filters.push('c.fecha_inicio >= ?');
        params.push(req.query.desde);
      }
      if (req.query.hasta) {
        filters.push('c.fecha_inicio <= ?');
        params.push(req.query.hasta);
      }

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

  // helper check solapamiento: same veterinarian
  async _hasOverlap(veterinario_id, fecha_inicio, duracion_min, excludeId = null) {
    if (!veterinario_id) return false;
    // buscamos citas que se solapen:
    // nueva_start < existing_end AND existing_start < nueva_end
    const nuevaStart = fecha_inicio;
    const nuevaEndExpr = `DATE_ADD(?, INTERVAL ? MINUTE)`;
    const paramsBase = [nuevaStart, duracion_min];

    let sql = `
      SELECT 1 FROM citas c
      WHERE c.veterinario_id = ?
        AND (? < DATE_ADD(c.fecha_inicio, INTERVAL c.duracion_min MINUTE))
        AND (c.fecha_inicio < ${nuevaEndExpr})
    `;
    const params = [veterinario_id, ...paramsBase, ...paramsBase]; // note: we repeat nuevaStart,duracion_min for the expression
    if (excludeId) {
      sql += ` AND c.id != ?`;
      params.push(excludeId);
    }
    sql += ` LIMIT 1`;
    // Adjust params ordering: the SQL uses ? placeholders in the shown order:
    // first ? -> veterinario_id
    // second ? -> nuevaStart (for ? < DATE_ADD(...))
    // third ? -> nuevaStart (inside DATE_ADD(?, INTERVAL ? MINUTE))
    // fourth ? -> duracion_min
    // So build accordingly:
    const finalParams = [veterinario_id, nuevaStart, nuevaStart, duracion_min];
    if (excludeId) finalParams.push(excludeId);

    const [rows] = await db.query(sql, finalParams);
    return (rows.length > 0);
  },

  // POST /citas
  async create(req, res) {
    try {
      // validations (express-validator in route should already run)
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Errores de validación', errors: errors.array() });
      }

      const { mascota_id, propietario_id, veterinario_id, tipo_consulta, motivo, fecha_inicio, duracion_min } = req.body;

      // validaciones básicas
      if (!mascota_id || !propietario_id || !fecha_inicio) {
        return res.status(400).json({ success: false, message: 'mascota_id, propietario_id y fecha_inicio son requeridos' });
      }

      // validar que la mascota existe y pertenece al propietario indicado
      const [mrows] = await db.query('SELECT id, owner_id FROM mascotas WHERE id = ?', [mascota_id]);
      if (!mrows.length) return res.status(400).json({ success: false, message: 'Mascota no existe' });
      const m = mrows[0];
      // nota: tu esquema usa owner_id en mascotas; aceptación de ambos nombres
      const mascotaOwnerId = m.owner_id || m.propietario_id;
      if (Number(mascotaOwnerId) !== Number(propietario_id)) {
        return res.status(400).json({ success: false, message: 'La mascota no pertenece al propietario indicado' });
      }

      // permisos: si quien crea es propietario, asegurar que propietario_id coincide con su token.id
      if (req.user.role === 'propietario') {
        if (Number(req.user.userId) !== Number(propietario_id)) {
          return res.status(403).json({ success: false, message: 'No autorizado para crear cita para otro propietario' });
        }
      }

      // validamos veterinario si se pasó: debe existir y ser admin (veterinario = usuario con role admin)
      let vetIdToUse = null;
      if (veterinario_id) {
        const [urows] = await db.query('SELECT id, role FROM usuarios WHERE id = ?', [veterinario_id]);
        if (!urows.length) return res.status(400).json({ success: false, message: 'Veterinario no encontrado' });
        if ((urows[0].role || '').toLowerCase() !== 'admin') {
          return res.status(400).json({ success: false, message: 'El usuario seleccionado no es un veterinario (role admin)' });
        }
        vetIdToUse = veterinarian_idOrNumber(veterinario_id);
      }

      const fecha = parseDate(fecha_inicio);
      if (!fecha) return res.status(400).json({ success: false, message: 'fecha_inicio inválida' });

      const durMin = typeof duracion_min !== 'undefined' && duracion_min !== null ? Number(duracion_min) : 30;
      if (isNaN(durMin) || durMin <= 0) return res.status(400).json({ success: false, message: 'duracion_min inválida' });

      // comprobar solapamientos si hay veterinario asignado
      if (vetIdToUse) {
        const hasOverlap = await CitasController._hasOverlap(vetIdToUse, fecha.toISOString().slice(0,19).replace('T',' '), durMin);
        if (hasOverlap) {
          return res.status(409).json({ success: false, message: 'Conflicto: el veterinario tiene otra cita en ese horario' });
        }
      }

      // insertar
      const createdBy = req.user?.userId || null;
      const insertSql = `INSERT INTO citas (mascota_id, propietario_id, veterinario_id, tipo_consulta, motivo, fecha_inicio, duracion_min, estado, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      const insertParams = [mascota_id, propietario_id, vetIdToUse, tipo_consulta || 'consulta general', motivo || null, formatDateToSQL(fecha), durMin, 'pendiente', createdBy];
      const [result] = await db.query(insertSql, insertParams);

      // devolver cita creada (con joins)
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

      // permisos: solo admin o propietario dueño o veterinarian assigned pueden editar (simplificado)
      const userRole = req.user.role;
      const userId = req.user.userId;
      if (userRole === 'propietario' && Number(userId) !== Number(existing.propietario_id)) {
        return res.status(403).json({ success: false, message: 'No autorizado para editar esta cita' });
      }

      // recoger campos
      const { mascota_id, propietario_id, veterinario_id, tipo_consulta, motivo, fecha_inicio, duracion_min, estado } = req.body;

      // si cambian mascota/propietario validar coherencia
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

      // comprobar solapamientos si vetToUse
      if (vetToUse) {
        const hasOverlap = await CitasController._hasOverlap(vetToUse, fecha.toISOString().slice(0,19).replace('T',' '), durMin, id);
        if (hasOverlap) {
          return res.status(409).json({ success: false, message: 'Conflicto: el veterinario tiene otra cita en ese horario' });
        }
      }

      // armar UPDATE con COALESCE-like (si campo no viene, usar existing)
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
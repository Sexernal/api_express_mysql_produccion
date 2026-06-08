// controllers/citasController.js
const db = require('../db');
const { validationResult } = require('express-validator');

/**
 * CitasController - incluye control de solapamientos por veterinario,
 * buffer opcional, endpoint /citas/slots, correcciones de columnas DB
 * y log de auditoría de cambios de estado.
 */

function parseDate(val) {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return (aStart < bEnd && bStart < aEnd);
}

async function _hasOverlap(veterinario_id, fecha_inicio, duracion_min, excludeId = null, bufferMin = 10) {
  if (!veterinario_id) return false;
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

/* ──────────────────────────────────────────────
   HELPER: Log de auditoría
   No lanza error si falla — jamás bloquea la operación principal.
────────────────────────────────────────────── */
async function _logCita(db, { cita_id, usuario_id, usuario_role, accion, estado_anterior = null, estado_nuevo = null, notas = null }) {
  try {
    let usuario_nombre = null;
    if (usuario_id) {
      if (usuario_role === 'propietario') {
        const [rows] = await db.query('SELECT nombre FROM propietarios WHERE id = ?', [usuario_id]);
        if (rows.length) usuario_nombre = rows[0].nombre;
      } else {
        const [rows] = await db.query('SELECT nombre FROM usuarios WHERE id = ?', [usuario_id]);
        if (rows.length) usuario_nombre = rows[0].nombre;
      }
    }
    await db.query(
      `INSERT INTO citas_log (cita_id, usuario_id, usuario_nombre, usuario_role, accion, estado_anterior, estado_nuevo, notas)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [cita_id, usuario_id ?? null, usuario_nombre, usuario_role ?? null, accion, estado_anterior ?? null, estado_nuevo ?? null, notas ?? null]
    );
  } catch (err) {
    console.error('Error escribiendo log de cita:', err.message);
  }
}

/* ──────────────────────────────────────────────
   Helpers de slots
────────────────────────────────────────────── */

function getDurationForTipo(t) {
  const map = {
    "consulta general": 30,
    "vacunacion": 20,
    "urgencia": 60,
    "cirugia": 120,
    "peluqueria": 45,
    "control": 20,
    "desparacitacion": 15
  };
  return map[(t || "").toLowerCase()] || 30;
}

function getWindowsForTipo(t) {
  const low = (t || "").toLowerCase();
  switch (low) {
    case "vacunacion":     return [{ from: "08:00", to: "12:30" }, { from: "14:00", to: "17:00" }];
    case "cirugia":        return [{ from: "08:00", to: "12:00" }];
    case "peluqueria":     return [{ from: "09:00", to: "16:00" }];
    case "urgencia":       return [{ from: "07:00", to: "17:00" }];
    case "control":        return [{ from: "07:00", to: "17:00" }];
    case "desparacitacion":return [{ from: "07:00", to: "17:00" }];
    default:               return [{ from: "07:00", to: "17:00" }];
  }
}

function parseHHMM(hhmm) {
  const [hh, mm] = hhmm.split(":").map(Number);
  return hh * 60 + mm;
}
function minutesToHHMM(m) {
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
}

function generateSlotsNode(dateStr, tipoStr, vetList, existingCitas) {
  if (!dateStr || !tipoStr) return { slotsByVet: {}, durationMin: 0 };
  const durationMin = getDurationForTipo(tipoStr);
  const windows = getWindowsForTipo(tipoStr);
  const CLINIC_OPEN = "07:00";
  const CLINIC_CLOSE = "17:00";

  const citasByVet = {};
  for (const c of existingCitas) {
    const vid = c.veterinario_id ? String(c.veterinario_id) : "null";
    if (!citasByVet[vid]) citasByVet[vid] = [];
    const start = new Date(c.fecha_inicio || c.fecha || "");
    const end = new Date(start.getTime() + Number(c.duracion_min || c.duracion || 0) * 60000);
    citasByVet[vid].push({ start, end });
  }

  const slotsByVet = {};
  for (const vet of vetList) {
    const vid = String(vet.id);
    slotsByVet[vid] = [];
    for (const w of windows) {
      const windowFromMin = Math.max(parseHHMM(CLINIC_OPEN), parseHHMM(w.from));
      const windowToMin   = Math.min(parseHHMM(CLINIC_CLOSE), parseHHMM(w.to));
      const lastStartMin  = windowToMin - durationMin;
      if (lastStartMin < windowFromMin) continue;

      let t = windowFromMin;
      const step = 15;
      while (t <= lastStartMin) {
        const timeStr      = minutesToHHMM(t);
        const startIsoLocal = `${dateStr}T${timeStr}`;
        const start        = new Date(`${dateStr}T${timeStr}:00`);
        if (isNaN(start.getTime())) { t += step; continue; }
        const end = new Date(start.getTime() + durationMin * 60000);

        const vetCitas = citasByVet[vid] || [];
        let conflict = false;
        for (const c of vetCitas) {
          if (overlaps(start.getTime(), end.getTime(), c.start.getTime(), c.end.getTime())) {
            conflict = true; break;
          }
        }

        if (!conflict) {
          slotsByVet[vid].push({ timeStr, startIsoLocal });
          t += durationMin;
        } else {
          t += step;
        }
      }
    }
    slotsByVet[vid].sort((a, b) => a.startIsoLocal.localeCompare(b.startIsoLocal));
  }

  return { slotsByVet, durationMin };
}

/* ──────────────────────────────────────────────
   Controller principal
────────────────────────────────────────────── */

const CitasController = {

  // GET /citas
  async list(req, res) {
    try {
      const page   = Math.max(1, parseInt(req.query.page  || 1));
      const limit  = Math.min(200, parseInt(req.query.limit || 50));
      const offset = (page - 1) * limit;

      const filters = [], params = [];
      if (req.query.mascota_id)     { filters.push('c.mascota_id = ?');     params.push(req.query.mascota_id); }
      if (req.query.propietario_id) { filters.push('c.propietario_id = ?'); params.push(req.query.propietario_id); }
      if (req.query.veterinario_id) { filters.push('c.veterinario_id = ?'); params.push(req.query.veterinario_id); }
      if (req.query.desde)          { filters.push('c.fecha_inicio >= ?');  params.push(req.query.desde); }
      if (req.query.hasta)          { filters.push('c.fecha_inicio <= ?');  params.push(req.query.hasta); }

      const where = filters.length ? 'WHERE ' + filters.join(' AND ') : '';

      const [countRows] = await db.query(`SELECT COUNT(*) AS total FROM citas c ${where}`, params);
      const total = countRows[0]?.total || 0;

      const [rows] = await db.query(`
        SELECT c.*,
               m.nombre AS mascota_nombre,
               p.nombre AS propietario_nombre,
               u.nombre AS veterinario_nombre
        FROM citas c
        LEFT JOIN mascotas    m ON c.mascota_id     = m.id
        LEFT JOIN propietarios p ON c.propietario_id = p.id
        LEFT JOIN usuarios    u ON c.veterinario_id  = u.id
        ${where}
        ORDER BY c.fecha_inicio DESC
        LIMIT ? OFFSET ?
      `, [...params, limit, offset]);

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
      const [rows] = await db.query(`
        SELECT c.*, m.nombre AS mascota_nombre, p.nombre AS propietario_nombre, u.nombre AS veterinario_nombre
        FROM citas c
        LEFT JOIN mascotas    m ON c.mascota_id     = m.id
        LEFT JOIN propietarios p ON c.propietario_id = p.id
        LEFT JOIN usuarios    u ON c.veterinario_id  = u.id
        WHERE c.id = ?`, [req.params.id]);
      if (!rows.length) return res.status(404).json({ success: false, message: 'Cita no encontrada' });
      res.json({ success: true, data: rows[0] });
    } catch (err) {
      console.error('Error get cita:', err);
      res.status(500).json({ success: false, message: 'Error al obtener cita', error: err.message });
    }
  },

  // GET /citas/:id/log
  async getLog(req, res) {
    try {
      if (req.user.role === 'propietario') {
        return res.status(403).json({ success: false, message: 'No autorizado para ver el historial de esta cita' });
      }
      const id = req.params.id;
      const [citaRows] = await db.query('SELECT id FROM citas WHERE id = ?', [id]);
      if (!citaRows.length) return res.status(404).json({ success: false, message: 'Cita no encontrada' });

      const [logs] = await db.query(
        'SELECT * FROM citas_log WHERE cita_id = ? ORDER BY created_at ASC',
        [id]
      );
      res.json({ success: true, data: logs });
    } catch (err) {
      console.error('Error getLog cita:', err);
      res.status(500).json({ success: false, message: 'Error al obtener historial', error: err.message });
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

      const [mrows] = await db.query('SELECT id, owner_id FROM mascotas WHERE id = ?', [mascota_id]);
      if (!mrows.length) return res.status(400).json({ success: false, message: 'Mascota no existe' });
      if (Number(mrows[0].owner_id) !== Number(propietario_id)) {
        return res.status(400).json({ success: false, message: 'La mascota no pertenece al propietario indicado' });
      }

      if (req.user.role === 'propietario' && Number(req.user.userId) !== Number(propietario_id)) {
        return res.status(403).json({ success: false, message: 'No autorizado para crear cita para otro propietario' });
      }

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

      const bufferMin = Number(req.body.buffer_min ?? req.body.bufferMin ?? 10);

      if (vetIdToUse) {
        const hasOverlap = await _hasOverlap(vetIdToUse, fecha.toISOString().slice(0,19).replace('T',' '), durMin, null, bufferMin);
        if (hasOverlap) {
          return res.status(409).json({ success: false, message: 'Conflicto: el veterinario tiene otra cita en ese horario (considerando buffer)' });
        }
      }

      const createdBy = req.user?.userId || null;
      const [result] = await db.query(
        `INSERT INTO citas (mascota_id, propietario_id, veterinario_id, tipo_consulta, motivo, fecha_inicio, duracion_min, estado, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [mascota_id, propietario_id, vetIdToUse, tipo_consulta || 'consulta general', motivo || null, formatDateToSQL(fecha), durMin, 'pendiente', createdBy]
      );

      await _logCita(db, {
        cita_id: result.insertId,
        usuario_id: req.user?.userId,
        usuario_role: req.user?.role,
        accion: 'creada',
        estado_nuevo: 'pendiente',
      });

      const [rows] = await db.query(`
        SELECT c.*, m.nombre AS mascota_nombre, p.nombre AS propietario_nombre, u.nombre AS veterinario_nombre
        FROM citas c
        LEFT JOIN mascotas    m ON c.mascota_id     = m.id
        LEFT JOIN propietarios p ON c.propietario_id = p.id
        LEFT JOIN usuarios    u ON c.veterinario_id  = u.id
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

      if (req.user.role === 'propietario' && Number(req.user.userId) !== Number(existing.propietario_id)) {
        return res.status(403).json({ success: false, message: 'No autorizado para editar esta cita' });
      }

      const { mascota_id, propietario_id, veterinario_id, tipo_consulta, motivo, fecha_inicio, duracion_min, estado } = req.body;

      if (mascota_id || propietario_id) {
        const mId = mascota_id || existing.mascota_id;
        const pId = propietario_id || existing.propietario_id;
        const [mrows] = await db.query('SELECT owner_id FROM mascotas WHERE id = ?', [mId]);
        if (!mrows.length) return res.status(400).json({ success: false, message: 'Mascota no existe' });
        if (Number(mrows[0].owner_id) !== Number(pId)) return res.status(400).json({ success: false, message: 'La mascota no pertenece al propietario indicado' });
      }

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

      const bufferMin = Number(req.body.buffer_min ?? req.body.bufferMin ?? 10);

      if (vetToUse) {
        const hasOverlap = await _hasOverlap(vetToUse, fecha.toISOString().slice(0,19).replace('T',' '), durMin, id, bufferMin);
        if (hasOverlap) {
          return res.status(409).json({ success: false, message: 'Conflicto: el veterinario tiene otra cita en ese horario (considerando buffer)' });
        }
      }

      await db.query(
        `UPDATE citas SET
           mascota_id     = COALESCE(?, mascota_id),
           propietario_id = COALESCE(?, propietario_id),
           veterinario_id = ?,
           tipo_consulta  = COALESCE(?, tipo_consulta),
           motivo         = COALESCE(?, motivo),
           fecha_inicio   = ?,
           duracion_min   = COALESCE(?, duracion_min),
           estado         = COALESCE(?, estado),
           updated_at     = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [mascota_id || null, propietario_id || null, vetToUse, tipo_consulta || null, motivo || null,
         formatDateToSQL(fecha), durMin, estado || null, id]
      );

      await _logCita(db, {
        cita_id: Number(id),
        usuario_id: req.user?.userId,
        usuario_role: req.user?.role,
        accion: 'actualizada',
      });

      const [rows] = await db.query(`
        SELECT c.*, m.nombre AS mascota_nombre, p.nombre AS propietario_nombre, u.nombre AS veterinario_nombre
        FROM citas c
        LEFT JOIN mascotas    m ON c.mascota_id     = m.id
        LEFT JOIN propietarios p ON c.propietario_id = p.id
        LEFT JOIN usuarios    u ON c.veterinario_id  = u.id
        WHERE c.id = ?`, [id]);

      res.json({ success: true, data: rows[0] });
    } catch (err) {
      console.error('Error update cita:', err);
      res.status(500).json({ success: false, message: 'Error al actualizar cita', error: err.message });
    }
  },

  // GET /citas/slots
  async getSlots(req, res) {
    try {
      const date = req.query.date;
      if (!date) return res.status(400).json({ success: false, message: 'date query parameter is required (YYYY-MM-DD)' });

      const tipo  = req.query.tipo || 'consulta general';
      const vetId = req.query.veterinario_id ? String(req.query.veterinario_id) : null;

      const [vRows] = await db.query("SELECT id, nombre, email FROM usuarios WHERE role = 'admin'");
      const vets    = vetId ? vRows.filter(v => String(v.id) === String(vetId)) : vRows;

      const [citasRows] = await db.query(
        "SELECT * FROM citas WHERE DATE(fecha_inicio) = ? AND estado != 'cancelada'",
        [date]
      );

      const { slotsByVet, durationMin } = generateSlotsNode(date, tipo, vets, citasRows);
      return res.json({ success: true, data: { slotsByVet, durationMin } });
    } catch (err) {
      console.error("Error getSlots:", err);
      return res.status(500).json({ success: false, message: 'Error generando slots', error: err.message });
    }
  },

  // POST /citas/:id/confirm
  async confirm(req, res) {
    try {
      const id = req.params.id;
      const [rows] = await db.query('SELECT * FROM citas WHERE id = ?', [id]);
      if (!rows.length) return res.status(404).json({ success: false, message: 'Cita no encontrada' });
      const cita = rows[0];

      if (req.user.role !== 'admin') {
        if (req.user.role === 'user' || (req.user.role === 'propietario' && Number(req.user.userId) === Number(cita.propietario_id))) {
          // recepcionista o propietario dueño: permitido
        } else {
          return res.status(403).json({ success: false, message: 'No autorizado para confirmar esta cita' });
        }
      }

      await db.query('UPDATE citas SET estado = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['confirmada', id]);

      await _logCita(db, {
        cita_id: Number(id),
        usuario_id: req.user?.userId,
        usuario_role: req.user?.role,
        accion: 'confirmada',
        estado_anterior: cita.estado,
        estado_nuevo: 'confirmada',
      });

      const [r2] = await db.query(`
        SELECT c.*, m.nombre AS mascota_nombre, p.nombre AS propietario_nombre, u.nombre AS veterinario_nombre
        FROM citas c
        LEFT JOIN mascotas    m ON c.mascota_id     = m.id
        LEFT JOIN propietarios p ON c.propietario_id = p.id
        LEFT JOIN usuarios    u ON c.veterinario_id  = u.id
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

      if (req.user.role !== 'admin') {
        if (req.user.role === 'user' || (req.user.role === 'propietario' && Number(req.user.userId) === Number(cita.propietario_id))) {
          // recepcionista o propietario dueño: permitido
        } else {
          return res.status(403).json({ success: false, message: 'No autorizado para marcar completada esta cita' });
        }
      }

      await db.query('UPDATE citas SET estado = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['completada', id]);

      await _logCita(db, {
        cita_id: Number(id),
        usuario_id: req.user?.userId,
        usuario_role: req.user?.role,
        accion: 'completada',
        estado_anterior: cita.estado,
        estado_nuevo: 'completada',
      });

      const [r2] = await db.query(`
        SELECT c.*, m.nombre AS mascota_nombre, p.nombre AS propietario_nombre, u.nombre AS veterinario_nombre
        FROM citas c
        LEFT JOIN mascotas    m ON c.mascota_id     = m.id
        LEFT JOIN propietarios p ON c.propietario_id = p.id
        LEFT JOIN usuarios    u ON c.veterinario_id  = u.id
        WHERE c.id = ?`, [id]);

      res.json({ success: true, data: r2[0] });
    } catch (err) {
      console.error('Error complete cita:', err);
      res.status(500).json({ success: false, message: 'Error al marcar completada', error: err.message });
    }
  },

  // PATCH /citas/:id/status
  async changeStatus(req, res) {
    try {
      const id = req.params.id;
      const { estado } = req.body;

      const allowed = ['pendiente','confirmada','completada','cancelada'];
      if (!estado || !allowed.includes(estado)) {
        return res.status(400).json({ success: false, message: 'Estado inválido. Valores permitidos: ' + allowed.join(', ') });
      }

      const [rows] = await db.query('SELECT * FROM citas WHERE id = ?', [id]);
      if (!rows.length) return res.status(404).json({ success: false, message: 'Cita no encontrada' });
      const cita = rows[0];

      if (req.user.role !== 'admin') {
        if (!(req.user.role === 'user' || (req.user.role === 'propietario' && Number(req.user.userId) === Number(cita.propietario_id)))) {
          return res.status(403).json({ success: false, message: 'No autorizado para cambiar estado de esta cita' });
        }
      }

      await db.query('UPDATE citas SET estado = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [estado, id]);

      await _logCita(db, {
        cita_id: Number(id),
        usuario_id: req.user?.userId,
        usuario_role: req.user?.role,
        accion: 'estado_cambiado',
        estado_anterior: cita.estado,
        estado_nuevo: estado,
      });

      const [r2] = await db.query(`
        SELECT c.*, m.nombre AS mascota_nombre, p.nombre AS propietario_nombre, u.nombre AS veterinario_nombre
        FROM citas c
        LEFT JOIN mascotas    m ON c.mascota_id     = m.id
        LEFT JOIN propietarios p ON c.propietario_id = p.id
        LEFT JOIN usuarios    u ON c.veterinario_id  = u.id
        WHERE c.id = ?`, [id]);

      res.json({ success: true, data: r2[0] });
    } catch (err) {
      console.error('Error changeStatus cita:', err);
      res.status(500).json({ success: false, message: 'Error al cambiar estado', error: err.message });
    }
  },

  // DELETE /citas/:id
  async remove(req, res) {
    try {
      const id = req.params.id;
      const [rows] = await db.query('SELECT * FROM citas WHERE id = ?', [id]);
      if (!rows.length) return res.status(404).json({ success: false, message: 'Cita no encontrada' });
      const cita = rows[0];

      if (req.user.role !== 'admin') {
        if (req.user.role === 'user' || (req.user.role === 'propietario' && Number(req.user.userId) === Number(cita.propietario_id))) {
          // recepcionista o propietario dueño: permitido
        } else {
          return res.status(403).json({ success: false, message: 'No autorizado para eliminar esta cita' });
        }
      }

      // Loguear antes de eliminar (la FK ON DELETE CASCADE borra el log también,
      // pero si quieres conservar el log de citas eliminadas cambia la FK a SET NULL en cita_id)
      await _logCita(db, {
        cita_id: Number(id),
        usuario_id: req.user?.userId,
        usuario_role: req.user?.role,
        accion: 'eliminada',
        estado_anterior: cita.estado,
      });

      await db.query('DELETE FROM citas WHERE id = ?', [id]);
      res.json({ success: true, message: 'Cita eliminada' });
    } catch (err) {
      console.error('Error delete cita:', err);
      res.status(500).json({ success: false, message: 'Error al eliminar cita', error: err.message });
    }
  }
};

function formatDateToSQL(dt) {
  const pad = n => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
}

module.exports = CitasController;
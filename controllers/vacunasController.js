// controllers/vacunasController.js
const db = require('../db');

function toYMD(val) {
  if (!val) return null;
  if (val instanceof Date) {
    const pad = n => String(n).padStart(2, '0');
    return `${val.getFullYear()}-${pad(val.getMonth() + 1)}-${pad(val.getDate())}`;
  }
  const m = String(val).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function displayYMD(ymd) {
  if (!ymd) return null;
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

function isValidYMD(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime());
}

function computeEstado(ymdProxima, cicloCompletado) {
  if (cicloCompletado) return { estado: 'completado', dias_restantes: null };
  if (!ymdProxima) return { estado: 'sin_proxima', dias_restantes: null };
  const [y, m, d] = ymdProxima.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const today  = new Date(); today.setHours(0, 0, 0, 0);
  const dias   = Math.round((target - today) / 86400000);
  if (dias < 0)   return { estado: 'vencida',  dias_restantes: dias };
  if (dias <= 30) return { estado: 'proxima',  dias_restantes: dias };
  return { estado: 'vigente', dias_restantes: dias };
}

const SELECT_BASE = `
  SELECT v.*, u.nombre AS veterinario_nombre, m.nombre AS mascota_nombre
  FROM vacunas v
  LEFT JOIN usuarios u ON v.veterinario_id = u.id
  LEFT JOIN mascotas m ON v.mascota_id     = m.id
`;

function mapRow(r) {
  const fa = toYMD(r.fecha_aplicacion);
  const fp = toYMD(r.fecha_proxima);
  const { estado, dias_restantes } = computeEstado(fp, r.ciclo_completado);
  return {
    ...r,
    fecha_aplicacion: fa,
    fecha_proxima: fp,
    fecha_aplicacion_display: displayYMD(fa) || '—',
    fecha_proxima_display:    displayYMD(fp) || '—',
    estado,
    dias_restantes,
    // Grupo efectivo de la serie: la primera dosis es su propia raíz
    grupo_id: r.grupo_id || r.id,
  };
}

// Numera las dosis dentro de cada serie (1ª, 2ª, 3ª...) en orden cronológico.
// Muta los objetos ya mapeados; no altera el orden del arreglo devuelto.
function numerarDosis(rows) {
  const grupos = new Map();
  for (const r of rows) {
    if (!grupos.has(r.grupo_id)) grupos.set(r.grupo_id, []);
    grupos.get(r.grupo_id).push(r);
  }
  for (const lista of grupos.values()) {
    lista
      .slice()
      .sort((a, b) => {
        const fa = a.fecha_aplicacion || '';
        const fb = b.fecha_aplicacion || '';
        if (fa !== fb) return fa < fb ? -1 : 1;
        return a.id - b.id;
      })
      .forEach((r, i, arr) => {
        r.dosis_numero = i + 1;
        r.total_dosis  = arr.length;
      });
  }
  return rows;
}

// Grupo al que debe unirse una nueva dosis de esa vacuna en esa mascota.
// NULL si es la primera vez que se registra esa vacuna para la mascota.
async function resolverGrupo(mascotaId, nombreVacuna) {
  const [prev] = await db.query(
    'SELECT id, grupo_id FROM vacunas WHERE mascota_id = ? AND nombre_vacuna = ? ORDER BY id ASC LIMIT 1',
    [mascotaId, nombreVacuna]
  );
  return prev.length ? (prev[0].grupo_id || prev[0].id) : null;
}

async function resolveVet(req) {
  if (req.body.veterinario_id) {
    const [u] = await db.query('SELECT id, role FROM usuarios WHERE id = ?', [req.body.veterinario_id]);
    if (!u.length) return { error: 'Veterinario no encontrado' };
    if ((u[0].role || '').toLowerCase() !== 'admin') return { error: 'El usuario seleccionado no es un veterinario' };
    return { vetId: Number(req.body.veterinario_id) };
  }
  return { vetId: req.user?.userId || null };
}

const VacunasController = {

  async listByPet(req, res) {
    try {
      const petId = req.query.pet_id || req.query.mascota_id || null;
      let rows;
      if (petId) {
        [rows] = await db.query(`${SELECT_BASE} WHERE v.mascota_id = ? ORDER BY v.fecha_aplicacion DESC, v.id DESC`, [petId]);
      } else {
        [rows] = await db.query(`${SELECT_BASE} ORDER BY v.fecha_aplicacion DESC LIMIT 200`);
      }
      res.json({ success: true, data: numerarDosis(rows.map(mapRow)) });
    } catch (err) {
      console.error('Error listByPet vacunas:', err);
      res.status(500).json({ success: false, message: 'Error al listar vacunas', error: err.message });
    }
  },

  async proximas(req, res) {
    try {
      const dias = Math.min(365, Math.max(1, parseInt(req.query.dias) || 30));
      const [rows] = await db.query(
        `${SELECT_BASE}
         WHERE v.fecha_proxima IS NOT NULL
           AND v.ciclo_completado = FALSE
           AND v.fecha_proxima <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
         ORDER BY v.fecha_proxima ASC`,
        [dias]
      );
      res.json({ success: true, data: rows.map(mapRow) });
    } catch (err) {
      console.error('Error proximas vacunas:', err);
      res.status(500).json({ success: false, message: 'Error al obtener proximas vacunas', error: err.message });
    }
  },

  async getById(req, res) {
    try {
      const [rows] = await db.query(`${SELECT_BASE} WHERE v.id = ?`, [req.params.id]);
      if (!rows.length) return res.status(404).json({ success: false, message: 'Vacuna no encontrada' });
      res.json({ success: true, data: mapRow(rows[0]) });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Error al obtener vacuna', error: err.message });
    }
  },

  async create(req, res) {
    try {
      const mascotaId = req.body.pet_id || req.body.mascota_id;
      if (!mascotaId) return res.status(400).json({ success: false, message: 'mascota_id requerido' });
      const [mRows] = await db.query('SELECT id FROM mascotas WHERE id = ?', [mascotaId]);
      if (!mRows.length) return res.status(400).json({ success: false, message: 'Mascota no existe' });
      const nombre_vacuna = (req.body.nombre_vacuna || '').trim();
      if (!nombre_vacuna) return res.status(400).json({ success: false, message: 'nombre_vacuna requerido' });
      const fecha_aplicacion = req.body.fecha_aplicacion;
      if (!isValidYMD(fecha_aplicacion))
        return res.status(400).json({ success: false, message: 'fecha_aplicacion inválida (formato YYYY-MM-DD)' });
      let fecha_proxima = null;
      if (req.body.fecha_proxima) {
        if (!isValidYMD(req.body.fecha_proxima))
          return res.status(400).json({ success: false, message: 'fecha_proxima inválida (formato YYYY-MM-DD)' });
        fecha_proxima = req.body.fecha_proxima;
      }
      const { vetId, error } = await resolveVet(req);
      if (error) return res.status(400).json({ success: false, message: error });
      const producto = req.body.producto ? String(req.body.producto).trim() : null;
      const lote     = req.body.lote     ? String(req.body.lote).trim()     : null;
      const notas    = req.body.notas    ? String(req.body.notas)           : null;
      // Si la mascota ya tiene esa vacuna, la nueva dosis se une a la misma serie
      const grupoId = await resolverGrupo(mascotaId, nombre_vacuna);
      const [result] = await db.query(
        `INSERT INTO vacunas (mascota_id, grupo_id, nombre_vacuna, producto, lote, fecha_aplicacion, fecha_proxima, veterinario_id, notas)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [mascotaId, grupoId, nombre_vacuna, producto, lote, fecha_aplicacion, fecha_proxima, vetId, notas]
      );
      const [rows] = await db.query(`${SELECT_BASE} WHERE v.id = ?`, [result.insertId]);
      res.status(201).json({ success: true, data: mapRow(rows[0]) });
    } catch (err) {
      console.error('Error create vacuna:', err);
      res.status(500).json({ success: false, message: 'Error al crear vacuna', error: err.message });
    }
  },

  async update(req, res) {
    try {
      const id = req.params.id;
      const [exRows] = await db.query('SELECT * FROM vacunas WHERE id = ?', [id]);
      if (!exRows.length) return res.status(404).json({ success: false, message: 'Vacuna no encontrada' });
      const cur = exRows[0];
      const nombre_vacuna = (req.body.nombre_vacuna !== undefined && String(req.body.nombre_vacuna).trim() !== '')
        ? String(req.body.nombre_vacuna).trim() : cur.nombre_vacuna;
      let fecha_aplicacion = toYMD(cur.fecha_aplicacion);
      if (req.body.fecha_aplicacion !== undefined && req.body.fecha_aplicacion !== '') {
        if (!isValidYMD(req.body.fecha_aplicacion))
          return res.status(400).json({ success: false, message: 'fecha_aplicacion inválida (formato YYYY-MM-DD)' });
        fecha_aplicacion = req.body.fecha_aplicacion;
      }
      let fecha_proxima = toYMD(cur.fecha_proxima);
      if (req.body.fecha_proxima !== undefined) {
        if (!req.body.fecha_proxima) { fecha_proxima = null; }
        else {
          if (!isValidYMD(req.body.fecha_proxima))
            return res.status(400).json({ success: false, message: 'fecha_proxima inválida (formato YYYY-MM-DD)' });
          fecha_proxima = req.body.fecha_proxima;
        }
      }
      const producto = req.body.producto !== undefined ? (req.body.producto || null) : cur.producto;
      const lote     = req.body.lote     !== undefined ? (req.body.lote || null)     : cur.lote;
      const notas    = req.body.notas    !== undefined ? (req.body.notas || null)    : cur.notas;
      let veterinario_id = cur.veterinario_id;
      if (req.body.veterinario_id !== undefined) {
        if (!req.body.veterinario_id) { veterinario_id = null; }
        else {
          const [u] = await db.query('SELECT id, role FROM usuarios WHERE id = ?', [req.body.veterinario_id]);
          if (!u.length) return res.status(400).json({ success: false, message: 'Veterinario no encontrado' });
          if ((u[0].role || '').toLowerCase() !== 'admin')
            return res.status(400).json({ success: false, message: 'El usuario seleccionado no es un veterinario' });
          veterinario_id = Number(req.body.veterinario_id);
        }
      }
      await db.query(
        `UPDATE vacunas SET nombre_vacuna=?, producto=?, lote=?, fecha_aplicacion=?,
         fecha_proxima=?, veterinario_id=?, notas=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        [nombre_vacuna, producto, lote, fecha_aplicacion, fecha_proxima, veterinario_id, notas, id]
      );
      const [rows] = await db.query(`${SELECT_BASE} WHERE v.id = ?`, [id]);
      res.json({ success: true, data: mapRow(rows[0]) });
    } catch (err) {
      console.error('Error update vacuna:', err);
      res.status(500).json({ success: false, message: 'Error al actualizar vacuna', error: err.message });
    }
  },

  // Marca el ciclo actual como completado y crea un nuevo registro para el siguiente ciclo
  async aplicar(req, res) {
    try {
      const id = req.params.id;
      const [exRows] = await db.query('SELECT * FROM vacunas WHERE id = ?', [id]);
      if (!exRows.length) return res.status(404).json({ success: false, message: 'Vacuna no encontrada' });
      const cur = exRows[0];
      if (cur.ciclo_completado)
        return res.status(400).json({ success: false, message: 'Este ciclo ya fue marcado como completado' });
      const fecha_aplicacion = req.body.fecha_aplicacion;
      if (!isValidYMD(fecha_aplicacion))
        return res.status(400).json({ success: false, message: 'fecha_aplicacion inválida (formato YYYY-MM-DD)' });
      let fecha_proxima = null;
      if (req.body.fecha_proxima) {
        if (!isValidYMD(req.body.fecha_proxima))
          return res.status(400).json({ success: false, message: 'fecha_proxima inválida (formato YYYY-MM-DD)' });
        fecha_proxima = req.body.fecha_proxima;
      }
      const { vetId, error } = await resolveVet(req);
      if (error) return res.status(400).json({ success: false, message: error });
      const producto = req.body.producto ? String(req.body.producto).trim() : (cur.producto || null);
      const lote     = req.body.lote     ? String(req.body.lote).trim()     : null;
      const notas    = req.body.notas    ? String(req.body.notas)           : null;

      await db.query('UPDATE vacunas SET ciclo_completado=TRUE, updated_at=CURRENT_TIMESTAMP WHERE id=?', [id]);

      // La nueva dosis continúa la serie de la dosis anterior
      const grupoId = cur.grupo_id || cur.id;
      const [result] = await db.query(
        `INSERT INTO vacunas (mascota_id, grupo_id, nombre_vacuna, producto, lote, fecha_aplicacion, fecha_proxima, veterinario_id, notas)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [cur.mascota_id, grupoId, cur.nombre_vacuna, producto, lote, fecha_aplicacion, fecha_proxima, vetId, notas]
      );
      const [[updatedOld]] = await db.query(`${SELECT_BASE} WHERE v.id = ?`, [id]);
      const [[newRow]]     = await db.query(`${SELECT_BASE} WHERE v.id = ?`, [result.insertId]);
      res.status(201).json({
        success: true,
        registro_anterior: mapRow(updatedOld),
        nuevo_registro:    mapRow(newRow),
      });
    } catch (err) {
      console.error('Error aplicar vacuna:', err);
      res.status(500).json({ success: false, message: 'Error al registrar dosis aplicada', error: err.message });
    }
  },

  async remove(req, res) {
    try {
      const [rows] = await db.query('SELECT id FROM vacunas WHERE id = ?', [req.params.id]);
      if (!rows.length) return res.status(404).json({ success: false, message: 'Vacuna no encontrada' });
      await db.query('DELETE FROM vacunas WHERE id = ?', [req.params.id]);
      res.json({ success: true, message: 'Vacuna eliminada' });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Error al eliminar vacuna', error: err.message });
    }
  },
};

module.exports = VacunasController;
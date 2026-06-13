// controllers/medicalController.js
const db         = require('../db');
const cloudinary = require('../config/cloudinary');

async function deleteFromCloudinary(publicId, mime) {
  if (!publicId) return;
  try {
    const resourceType = (mime || '').startsWith('image/') ? 'image' : 'raw';
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  } catch (err) {
    console.error('Error al eliminar de Cloudinary:', err.message);
  }
}

function parseDateFromInput(val) {
  if (!val) return new Date();
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    const [y, m, d] = val.split('-').map(Number);
    const now = new Date();
    return new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds());
  }
  return new Date(val);
}

function formatDateToSQLLocal(dt) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
}

function dateFromDbValue(val) {
  if (!val) return null;
  if (val instanceof Date) return val;
  const m = val.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (m) {
    const [_, y, mo, d, hh, mm, ss] = m;
    return new Date(Number(y), Number(mo)-1, Number(d), Number(hh), Number(mm), Number(ss));
  }
  const parsed = new Date(val);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function formatDisplayDate(dt) {
  if (!dt) return '-';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(dt.getDate())}/${pad(dt.getMonth()+1)}/${dt.getFullYear()}, ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
}

const SELECT_FICHA = `
  SELECT f.*, u.nombre AS creado_por_nombre, m.nombre AS mascota_nombre
  FROM fichas_medicas f
  LEFT JOIN usuarios u ON f.uploaded_by = u.id
  LEFT JOIN mascotas m ON f.mascota_id = m.id
`;

function mapRow(r) {
  const fechaDt = dateFromDbValue(r.fecha);
  return {
    ...r,
    filepath:      r.filepath || null,
    fecha_display: fechaDt ? formatDisplayDate(fechaDt) : '-',
  };
}

const MedicalController = {

  async listByPet(req, res) {
    try {
      const petId = req.query.pet_id || req.query.mascota_id || null;
      let rows;
      if (petId) {
        [rows] = await db.query(
          `${SELECT_FICHA} WHERE f.mascota_id = ? ORDER BY f.fecha DESC`, [petId]
        );
      } else {
        [rows] = await db.query(`${SELECT_FICHA} ORDER BY f.fecha DESC LIMIT 200`);
      }
      res.json({ success: true, data: rows.map(mapRow) });
    } catch (err) {
      console.error('Error listByPet:', err);
      res.status(500).json({ success: false, message: 'Error al listar fichas', error: err.message });
    }
  },

  async getById(req, res) {
    try {
      const [rows] = await db.query(`${SELECT_FICHA} WHERE f.id = ?`, [req.params.id]);
      if (!rows.length) return res.status(404).json({ success: false, message: 'Ficha no encontrada' });
      res.json({ success: true, data: mapRow(rows[0]) });
    } catch (err) {
      console.error('Error getById:', err);
      res.status(500).json({ success: false, message: 'Error al obtener ficha', error: err.message });
    }
  },

  async create(req, res) {
    try {
      const mascotaId = req.body.pet_id || req.body.mascota_id;
      if (!mascotaId) return res.status(400).json({ success: false, message: 'mascota_id requerido' });

      const [mRows] = await db.query('SELECT id FROM mascotas WHERE id = ?', [mascotaId]);
      if (!mRows.length) return res.status(400).json({ success: false, message: 'Mascota no existe' });

      const tipo               = req.body.tipo || 'consulta';
      const tipo_personalizado = (tipo === 'otro' && req.body.tipo_personalizado)
        ? req.body.tipo_personalizado.trim() : null;
      const fechaSql    = formatDateToSQLLocal(req.body.fecha ? parseDateFromInput(req.body.fecha) : new Date());
      const peso        = (req.body.peso !== undefined && req.body.peso !== '') ? req.body.peso : null;
      const temperatura = (req.body.temperatura !== undefined && req.body.temperatura !== '') ? req.body.temperatura : null;
      const nota        = req.body.nota || req.body.observaciones || null;
      const uploaded_by = req.user?.userId || req.user?.id || null;

      // req.file.filename = Cloudinary public_id
      // req.file.path     = Cloudinary secure_url
      let filename = null, filepath = null, mime = null, size_bytes = null;
      if (req.file) {
        filename   = req.file.filename;
        filepath   = req.file.path;
        mime       = req.file.mimetype;
        size_bytes = req.file.size;
      }

      const [result] = await db.query(
        `INSERT INTO fichas_medicas
         (mascota_id, tipo, tipo_personalizado, fecha, peso, temperatura, nota, filename, filepath, mime, size_bytes, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [mascotaId, tipo, tipo_personalizado, fechaSql, peso, temperatura, nota,
         filename, filepath, mime, size_bytes, uploaded_by]
      );

      const [rows] = await db.query(`${SELECT_FICHA} WHERE f.id = ?`, [result.insertId]);
      res.status(201).json({ success: true, data: mapRow(rows[0]) });
    } catch (err) {
      console.error('Error create ficha:', err);
      res.status(500).json({ success: false, message: 'Error al crear ficha', error: err.message });
    }
  },

  async update(req, res) {
    try {
      const id = req.params.id;
      const [existingRows] = await db.query('SELECT * FROM fichas_medicas WHERE id = ?', [id]);
      if (!existingRows.length) return res.status(404).json({ success: false, message: 'Ficha no encontrada' });
      const ex = existingRows[0];

      const tipo               = req.body.tipo || ex.tipo;
      const tipo_personalizado = (tipo === 'otro' && req.body.tipo_personalizado !== undefined)
        ? (req.body.tipo_personalizado?.trim() || null)
        : (tipo === 'otro' ? ex.tipo_personalizado : null);
      const fechaSql    = formatDateToSQLLocal(req.body.fecha ? parseDateFromInput(req.body.fecha) : dateFromDbValue(ex.fecha) || new Date());
      const peso        = (req.body.peso !== undefined && req.body.peso !== '') ? req.body.peso : ex.peso;
      const temperatura = (req.body.temperatura !== undefined && req.body.temperatura !== '') ? req.body.temperatura : ex.temperatura;
      const nota        = req.body.nota !== undefined ? req.body.nota : ex.nota;

      let filename = ex.filename, filepath = ex.filepath, mime = ex.mime, size_bytes = ex.size_bytes;
      if (req.file) {
        await deleteFromCloudinary(ex.filename, ex.mime);
        filename   = req.file.filename;
        filepath   = req.file.path;
        mime       = req.file.mimetype;
        size_bytes = req.file.size;
      }

      await db.query(
        `UPDATE fichas_medicas
         SET tipo = ?, tipo_personalizado = ?, fecha = ?, peso = ?, temperatura = ?,
             nota = ?, filename = ?, filepath = ?, mime = ?, size_bytes = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [tipo, tipo_personalizado, fechaSql, peso, temperatura, nota,
         filename, filepath, mime, size_bytes, id]
      );

      const [rows] = await db.query(`${SELECT_FICHA} WHERE f.id = ?`, [id]);
      res.json({ success: true, data: mapRow(rows[0]) });
    } catch (err) {
      console.error('Error update ficha:', err);
      res.status(500).json({ success: false, message: 'Error al actualizar ficha', error: err.message });
    }
  },

  async remove(req, res) {
    try {
      const [rows] = await db.query('SELECT * FROM fichas_medicas WHERE id = ?', [req.params.id]);
      if (!rows.length) return res.status(404).json({ success: false, message: 'Ficha no encontrada' });

      await deleteFromCloudinary(rows[0].filename, rows[0].mime);
      await db.query('DELETE FROM fichas_medicas WHERE id = ?', [req.params.id]);

      res.json({ success: true, message: 'Ficha eliminada' });
    } catch (err) {
      console.error('Error delete ficha:', err);
      res.status(500).json({ success: false, message: 'Error al eliminar ficha', error: err.message });
    }
  },
};

module.exports = MedicalController;
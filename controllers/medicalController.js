// controllers/medicalController.js
const db         = require('../db');
const cloudinary = require('../config/cloudinary');
const {
  resolverTratamiento,
  sincronizarFechaInicio,
  eliminarSiQuedaVacio,
} = require('../services/tratamientosService');

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
  SELECT f.*,
         u.nombre AS creado_por_nombre,
         m.nombre AS mascota_nombre,
         t.nombre AS tratamiento_nombre,
         t.estado AS tratamiento_estado
  FROM fichas_medicas f
  LEFT JOIN usuarios     u ON f.uploaded_by    = u.id
  LEFT JOIN mascotas     m ON f.mascota_id     = m.id
  LEFT JOIN tratamientos t ON f.tratamiento_id = t.id
`;

function mapRow(r) {
  const fechaDt = dateFromDbValue(r.fecha);
  return {
    ...r,
    filepath:       r.filepath || null,
    tratamiento_id: r.tratamiento_id || null,
    fecha_display:  fechaDt ? formatDisplayDate(fechaDt) : '-',
  };
}

// El formulario de fichas viaja como multipart/form-data, así que todo
// llega en texto: "" y "null" son formas de decir "sin tratamiento".
// Devuelve NaN si llega basura, para que el caller responda 400. Antes se
// convertia en null, que significa "sin tratamiento": un id mal escrito
// desagrupaba la ficha en silencio y respondia 200.
function idOpcional(val) {
  if (val === undefined) return undefined;
  if (val === null || val === '' || val === 'null' || val === 'undefined') return null;
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? n : NaN;
}

function idInvalido(...valores) {
  return valores.some(v => typeof v === 'number' && Number.isNaN(v));
}

const MedicalController = {

  async listByPet(req, res) {
    try {
      const petId = req.query.pet_id || req.query.mascota_id || null;

      // Filtros de agrupación:
      //   tratamiento_id=5     → solo las fichas de ese tratamiento
      //   agrupacion=sueltas   → solo consultas que no son parte de ninguno
      //   agrupacion=agrupadas → solo las que sí pertenecen a un tratamiento
      const where  = [];
      const params = [];
      if (petId) { where.push('f.mascota_id = ?'); params.push(petId); }

      const tratamientoId = idOpcional(req.query.tratamiento_id);
      if (tratamientoId) { where.push('f.tratamiento_id = ?'); params.push(tratamientoId); }

      if (req.query.agrupacion === 'sueltas')   where.push('f.tratamiento_id IS NULL');
      if (req.query.agrupacion === 'agrupadas') where.push('f.tratamiento_id IS NOT NULL');

      const [rows] = await db.query(
        `${SELECT_FICHA}
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY f.fecha DESC
         ${petId ? '' : 'LIMIT 200'}`,
        params
      );
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
    const conn = await db.getConnection();
    try {
      const mascotaId = req.body.pet_id || req.body.mascota_id;
      if (!mascotaId) return res.status(400).json({ success: false, message: 'mascota_id requerido' });

      const [mRows] = await conn.query('SELECT id FROM mascotas WHERE id = ?', [mascotaId]);
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

      const pedidoTratamiento = idOpcional(req.body.tratamiento_id);
      const pedidoSeguimiento = idOpcional(req.body.seguimiento_de);
      if (idInvalido(pedidoTratamiento, pedidoSeguimiento))
        return res.status(400).json({ success: false, message: 'tratamiento_id o seguimiento_de inválido' });

      await conn.beginTransaction();

      // Agrupación: o se une a un tratamiento existente, o nace uno nuevo
      // a partir de la ficha que se indicó como "seguimiento de".
      const { tratamientoId, error: errorGrupo } = await resolverTratamiento({
        mascotaId,
        tratamientoId: pedidoTratamiento,
        seguimientoDe: pedidoSeguimiento,
        userId:        uploaded_by,
      }, conn);

      if (errorGrupo) {
        await conn.rollback();
        return res.status(400).json({ success: false, message: errorGrupo });
      }

      const [result] = await conn.query(
        `INSERT INTO fichas_medicas
         (mascota_id, tratamiento_id, tipo, tipo_personalizado, fecha, peso, temperatura, nota, filename, filepath, mime, size_bytes, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [mascotaId, tratamientoId, tipo, tipo_personalizado, fechaSql, peso, temperatura, nota,
         filename, filepath, mime, size_bytes, uploaded_by]
      );

      if (tratamientoId) await sincronizarFechaInicio(tratamientoId, conn);
      await conn.commit();

      // conn (no db) a proposito: pedir una segunda conexion del pool sin haber
      // soltado esta agota el pool bajo carga y deja las peticiones colgadas.
      const [rows] = await conn.query(`${SELECT_FICHA} WHERE f.id = ?`, [result.insertId]);
      res.status(201).json({ success: true, data: mapRow(rows[0]) });
    } catch (err) {
      await conn.rollback().catch(() => {});
      console.error('Error create ficha:', err);
      res.status(500).json({ success: false, message: 'Error al crear ficha', error: err.message });
    } finally {
      conn.release();
    }
  },

  async update(req, res) {
    const conn = await db.getConnection();
    try {
      const id = req.params.id;
      const [existingRows] = await conn.query('SELECT * FROM fichas_medicas WHERE id = ?', [id]);
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

      // La agrupación solo se recalcula si el cliente mandó alguno de los
      // dos campos. Si no los manda, la ficha se queda donde estaba.
      const tratamientoPedido = idOpcional(req.body.tratamiento_id);
      const seguimientoPedido = idOpcional(req.body.seguimiento_de);
      if (idInvalido(tratamientoPedido, seguimientoPedido))
        return res.status(400).json({ success: false, message: 'tratamiento_id o seguimiento_de inválido' });

      await conn.beginTransaction();

      let tratamientoId = ex.tratamiento_id;

      if (tratamientoPedido !== undefined || seguimientoPedido !== undefined) {
        const resuelto = await resolverTratamiento({
          mascotaId:      ex.mascota_id,
          tratamientoId:  tratamientoPedido,
          seguimientoDe:  seguimientoPedido,
          userId:         req.user?.userId || req.user?.id || null,
          excluirFichaId: id,
        }, conn);

        if (resuelto.error) {
          await conn.rollback();
          return res.status(400).json({ success: false, message: resuelto.error });
        }
        tratamientoId = resuelto.tratamientoId;
      }

      await conn.query(
        `UPDATE fichas_medicas
         SET tratamiento_id = ?, tipo = ?, tipo_personalizado = ?, fecha = ?, peso = ?, temperatura = ?,
             nota = ?, filename = ?, filepath = ?, mime = ?, size_bytes = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [tratamientoId, tipo, tipo_personalizado, fechaSql, peso, temperatura, nota,
         filename, filepath, mime, size_bytes, id]
      );

      // Si la ficha cambió de grupo, el anterior puede haber quedado vacío
      const anterior = ex.tratamiento_id;
      if (anterior && Number(anterior) !== Number(tratamientoId)) {
        const borrado = await eliminarSiQuedaVacio(anterior, conn);
        if (!borrado) await sincronizarFechaInicio(anterior, conn);
      }
      if (tratamientoId) await sincronizarFechaInicio(tratamientoId, conn);

      await conn.commit();

      // conn (no db): ver la nota en create sobre agotar el pool
      const [rows] = await conn.query(`${SELECT_FICHA} WHERE f.id = ?`, [id]);
      res.json({ success: true, data: mapRow(rows[0]) });
    } catch (err) {
      await conn.rollback().catch(() => {});
      console.error('Error update ficha:', err);
      res.status(500).json({ success: false, message: 'Error al actualizar ficha', error: err.message });
    } finally {
      conn.release();
    }
  },

  async remove(req, res) {
    try {
      const [rows] = await db.query('SELECT * FROM fichas_medicas WHERE id = ?', [req.params.id]);
      if (!rows.length) return res.status(404).json({ success: false, message: 'Ficha no encontrada' });

      await deleteFromCloudinary(rows[0].filename, rows[0].mime);
      await db.query('DELETE FROM fichas_medicas WHERE id = ?', [req.params.id]);

      // Si era la última ficha de su tratamiento, el grupo ya no tiene sentido
      const tratamientoId = rows[0].tratamiento_id;
      if (tratamientoId) {
        const borrado = await eliminarSiQuedaVacio(tratamientoId);
        if (!borrado) await sincronizarFechaInicio(tratamientoId);
      }

      res.json({ success: true, message: 'Ficha eliminada' });
    } catch (err) {
      console.error('Error delete ficha:', err);
      res.status(500).json({ success: false, message: 'Error al eliminar ficha', error: err.message });
    }
  },
};

module.exports = MedicalController;
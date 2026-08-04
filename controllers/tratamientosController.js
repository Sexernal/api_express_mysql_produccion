// controllers/tratamientosController.js
const db = require('../db');
const {
  ESTADOS,
  NOMBRE_MAX,
  SELECT_TRATAMIENTO,
  toYMD,
  isValidYMD,
  mapTratamiento,
  sincronizarFechaInicio,
  eliminarSiQuedaVacio,
} = require('../services/tratamientosService');

// Fichas de un tratamiento, en orden cronológico (la 1ª consulta arriba)
const SELECT_FICHAS_DEL_TRATAMIENTO = `
  SELECT f.id, f.mascota_id, f.tratamiento_id, f.tipo, f.tipo_personalizado,
         f.fecha, f.peso, f.temperatura, f.nota, f.filepath, f.mime,
         u.nombre AS creado_por_nombre
  FROM fichas_medicas f
  LEFT JOIN usuarios u ON f.uploaded_by = u.id
  WHERE f.tratamiento_id = ?
  ORDER BY f.fecha ASC, f.id ASC
`;

async function cargarTratamiento(id, conn = db) {
  const [rows] = await conn.query(`${SELECT_TRATAMIENTO} WHERE t.id = ?`, [id]);
  return rows.length ? mapTratamiento(rows[0]) : null;
}

const TratamientosController = {

  async listByPet(req, res) {
    try {
      const petId  = req.query.pet_id || req.query.mascota_id || null;
      const estado = req.query.estado;

      const where  = [];
      const params = [];
      if (petId) { where.push('t.mascota_id = ?'); params.push(petId); }
      if (estado && ESTADOS.includes(estado)) { where.push('t.estado = ?'); params.push(estado); }

      const sql = `${SELECT_TRATAMIENTO}
                   ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                   ORDER BY t.fecha_inicio DESC, t.id DESC
                   ${petId ? '' : 'LIMIT 200'}`;

      const [rows] = await db.query(sql, params);
      res.json({ success: true, data: rows.map(mapTratamiento) });
    } catch (err) {
      console.error('Error listByPet tratamientos:', err);
      res.status(500).json({ success: false, message: 'Error al listar tratamientos', error: err.message });
    }
  },

  async getById(req, res) {
    try {
      const tratamiento = await cargarTratamiento(req.params.id);
      if (!tratamiento)
        return res.status(404).json({ success: false, message: 'Tratamiento no encontrado' });

      const [fichas] = await db.query(SELECT_FICHAS_DEL_TRATAMIENTO, [req.params.id]);
      res.json({ success: true, data: { ...tratamiento, fichas } });
    } catch (err) {
      console.error('Error getById tratamiento:', err);
      res.status(500).json({ success: false, message: 'Error al obtener tratamiento', error: err.message });
    }
  },

  // Crea un tratamiento y, opcionalmente, le asigna fichas existentes de una vez.
  // Útil para agrupar en retrospectiva consultas que ya estaban sueltas.
  async create(req, res) {
    const conn = await db.getConnection();
    try {
      const mascotaId = req.body.pet_id || req.body.mascota_id;
      if (!mascotaId)
        return res.status(400).json({ success: false, message: 'mascota_id requerido' });

      const nombre = (req.body.nombre || '').trim();
      if (!nombre)
        return res.status(400).json({ success: false, message: 'El nombre del tratamiento es requerido' });
      if (nombre.length > NOMBRE_MAX)
        return res.status(400).json({ success: false, message: `El nombre no puede pasar de ${NOMBRE_MAX} caracteres` });

      const [mRows] = await conn.query('SELECT id FROM mascotas WHERE id = ?', [mascotaId]);
      if (!mRows.length)
        return res.status(400).json({ success: false, message: 'Mascota no existe' });

      let fechaInicio = req.body.fecha_inicio || null;
      if (fechaInicio && !isValidYMD(fechaInicio))
        return res.status(400).json({ success: false, message: 'fecha_inicio inválida (formato YYYY-MM-DD)' });

      const fichaIds = Array.isArray(req.body.ficha_ids)
        ? req.body.ficha_ids.map(Number).filter(Boolean)
        : [];

      await conn.beginTransaction();

      // Las fichas deben ser todas de esta mascota
      let tratamientosTocados = [];
      if (fichaIds.length) {
        const [fRows] = await conn.query(
          `SELECT id, mascota_id, tratamiento_id, fecha FROM fichas_medicas WHERE id IN (?)`,
          [fichaIds]
        );
        if (fRows.length !== fichaIds.length) {
          await conn.rollback();
          return res.status(400).json({ success: false, message: 'Alguna de las fichas indicadas no existe' });
        }
        const ajena = fRows.find(f => Number(f.mascota_id) !== Number(mascotaId));
        if (ajena) {
          await conn.rollback();
          return res.status(400).json({ success: false, message: 'Alguna de las fichas pertenece a otra mascota' });
        }
        tratamientosTocados = [...new Set(fRows.map(f => f.tratamiento_id).filter(Boolean))];
        if (!fechaInicio) {
          const fechas = fRows.map(f => toYMD(f.fecha)).filter(Boolean).sort();
          fechaInicio = fechas[0] || null;
        }
      }

      if (!fechaInicio) fechaInicio = toYMD(new Date());

      const [result] = await conn.query(
        `INSERT INTO tratamientos (mascota_id, nombre, motivo, fecha_inicio, creado_por)
         VALUES (?, ?, ?, ?, ?)`,
        [mascotaId, nombre, req.body.motivo || null, fechaInicio, req.user?.userId || req.user?.id || null]
      );

      if (fichaIds.length) {
        await conn.query(
          'UPDATE fichas_medicas SET tratamiento_id = ? WHERE id IN (?)',
          [result.insertId, fichaIds]
        );
        // Los tratamientos de los que salieron esas fichas pueden haber quedado vacíos
        for (const viejo of tratamientosTocados) {
          const borrado = await eliminarSiQuedaVacio(viejo, conn);
          if (!borrado) await sincronizarFechaInicio(viejo, conn);
        }
      }

      await conn.commit();
      res.status(201).json({ success: true, data: await cargarTratamiento(result.insertId, conn) });
    } catch (err) {
      await conn.rollback().catch(() => {});
      console.error('Error create tratamiento:', err);
      res.status(500).json({ success: false, message: 'Error al crear tratamiento', error: err.message });
    } finally {
      conn.release();
    }
  },

  async update(req, res) {
    try {
      const id = req.params.id;
      const [exRows] = await db.query('SELECT * FROM tratamientos WHERE id = ?', [id]);
      if (!exRows.length)
        return res.status(404).json({ success: false, message: 'Tratamiento no encontrado' });
      const cur = exRows[0];

      let nombre = cur.nombre;
      if (req.body.nombre !== undefined) {
        const limpio = String(req.body.nombre).trim();
        if (!limpio)
          return res.status(400).json({ success: false, message: 'El nombre del tratamiento no puede quedar vacío' });
        if (limpio.length > NOMBRE_MAX)
          return res.status(400).json({ success: false, message: `El nombre no puede pasar de ${NOMBRE_MAX} caracteres` });
        nombre = limpio;
      }

      const motivo = req.body.motivo !== undefined ? (req.body.motivo || null) : cur.motivo;

      let estado = cur.estado;
      if (req.body.estado !== undefined) {
        if (!ESTADOS.includes(req.body.estado))
          return res.status(400).json({ success: false, message: `Estado inválido (${ESTADOS.join(' o ')})` });
        estado = req.body.estado;
      }

      let fechaInicio = toYMD(cur.fecha_inicio);
      if (req.body.fecha_inicio !== undefined && req.body.fecha_inicio) {
        if (!isValidYMD(req.body.fecha_inicio))
          return res.status(400).json({ success: false, message: 'fecha_inicio inválida (formato YYYY-MM-DD)' });
        fechaInicio = req.body.fecha_inicio;
      }

      let fechaFin = toYMD(cur.fecha_fin);
      if (req.body.fecha_fin !== undefined) {
        if (!req.body.fecha_fin) fechaFin = null;
        else {
          if (!isValidYMD(req.body.fecha_fin))
            return res.status(400).json({ success: false, message: 'fecha_fin inválida (formato YYYY-MM-DD)' });
          fechaFin = req.body.fecha_fin;
        }
      }

      // Al finalizar sin fecha explícita, cerramos hoy.
      // Al reabrir, la fecha de cierre deja de tener sentido.
      if (estado === 'finalizado' && !fechaFin) fechaFin = toYMD(new Date());
      if (estado === 'activo') fechaFin = null;

      if (fechaFin && fechaFin < fechaInicio)
        return res.status(400).json({ success: false, message: 'La fecha de fin no puede ser anterior al inicio' });

      await db.query(
        `UPDATE tratamientos
         SET nombre = ?, motivo = ?, estado = ?, fecha_inicio = ?, fecha_fin = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [nombre, motivo, estado, fechaInicio, fechaFin, id]
      );

      res.json({ success: true, data: await cargarTratamiento(id) });
    } catch (err) {
      console.error('Error update tratamiento:', err);
      res.status(500).json({ success: false, message: 'Error al actualizar tratamiento', error: err.message });
    }
  },

  // Agrega una ficha ya existente al tratamiento
  async agregarFicha(req, res) {
    const conn = await db.getConnection();
    try {
      const id      = req.params.id;
      const fichaId = req.body.ficha_id || req.body.fichaId;
      if (!fichaId)
        return res.status(400).json({ success: false, message: 'ficha_id requerido' });

      const [tRows] = await conn.query('SELECT id, mascota_id FROM tratamientos WHERE id = ?', [id]);
      if (!tRows.length)
        return res.status(404).json({ success: false, message: 'Tratamiento no encontrado' });

      const [fRows] = await conn.query(
        'SELECT id, mascota_id, tratamiento_id FROM fichas_medicas WHERE id = ?', [fichaId]
      );
      if (!fRows.length)
        return res.status(404).json({ success: false, message: 'Ficha no encontrada' });
      if (Number(fRows[0].mascota_id) !== Number(tRows[0].mascota_id))
        return res.status(400).json({ success: false, message: 'La ficha pertenece a otra mascota' });

      const anterior = fRows[0].tratamiento_id;
      if (Number(anterior) === Number(id))
        return res.json({ success: true, data: await cargarTratamiento(id, conn) });

      await conn.beginTransaction();
      await conn.query('UPDATE fichas_medicas SET tratamiento_id = ? WHERE id = ?', [id, fichaId]);
      if (anterior) {
        const borrado = await eliminarSiQuedaVacio(anterior, conn);
        if (!borrado) await sincronizarFechaInicio(anterior, conn);
      }
      await sincronizarFechaInicio(id, conn);
      await conn.commit();

      res.json({ success: true, data: await cargarTratamiento(id, conn) });
    } catch (err) {
      await conn.rollback().catch(() => {});
      console.error('Error agregarFicha:', err);
      res.status(500).json({ success: false, message: 'Error al agregar la ficha al tratamiento', error: err.message });
    } finally {
      conn.release();
    }
  },

  // Saca una ficha del tratamiento. La ficha NO se borra: vuelve a ser suelta.
  async quitarFicha(req, res) {
    const conn = await db.getConnection();
    try {
      const { id, fichaId } = req.params;
      const [fRows] = await conn.query(
        'SELECT id, tratamiento_id FROM fichas_medicas WHERE id = ?', [fichaId]
      );
      if (!fRows.length)
        return res.status(404).json({ success: false, message: 'Ficha no encontrada' });
      if (Number(fRows[0].tratamiento_id) !== Number(id))
        return res.status(400).json({ success: false, message: 'La ficha no pertenece a este tratamiento' });

      await conn.beginTransaction();
      await conn.query('UPDATE fichas_medicas SET tratamiento_id = NULL WHERE id = ?', [fichaId]);
      const borrado = await eliminarSiQuedaVacio(id, conn);
      if (!borrado) await sincronizarFechaInicio(id, conn);
      await conn.commit();

      res.json({
        success: true,
        message: borrado ? 'Ficha desagrupada. El tratamiento quedó vacío y se eliminó.' : 'Ficha desagrupada',
        tratamiento_eliminado: borrado,
        data: borrado ? null : await cargarTratamiento(id, conn),
      });
    } catch (err) {
      await conn.rollback().catch(() => {});
      console.error('Error quitarFicha:', err);
      res.status(500).json({ success: false, message: 'Error al quitar la ficha del tratamiento', error: err.message });
    } finally {
      conn.release();
    }
  },

  // Elimina el tratamiento. Las fichas quedan sueltas gracias al
  // ON DELETE SET NULL: jamás se borra historial clínico por aquí.
  async remove(req, res) {
    try {
      const [rows] = await db.query('SELECT id FROM tratamientos WHERE id = ?', [req.params.id]);
      if (!rows.length)
        return res.status(404).json({ success: false, message: 'Tratamiento no encontrado' });

      const [[{ total }]] = await db.query(
        'SELECT COUNT(*) AS total FROM fichas_medicas WHERE tratamiento_id = ?', [req.params.id]
      );

      await db.query('DELETE FROM tratamientos WHERE id = ?', [req.params.id]);
      res.json({
        success: true,
        message: `Tratamiento eliminado. ${total} ficha${total === 1 ? '' : 's'} volvieron a quedar como consultas sueltas.`,
        fichas_desagrupadas: Number(total),
      });
    } catch (err) {
      console.error('Error delete tratamiento:', err);
      res.status(500).json({ success: false, message: 'Error al eliminar tratamiento', error: err.message });
    }
  },
};

module.exports = TratamientosController;

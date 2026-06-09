// controllers/comandaController.js
const db = require('../db');

const ComandaController = {

  // GET /fichas/:fichaId/comanda
  async getByFicha(req, res) {
    try {
      const { fichaId } = req.params;
      const [items] = await db.query(
        'SELECT * FROM comanda_items WHERE ficha_id = ? ORDER BY id', [fichaId]
      );
      const [cobro] = await db.query(
        'SELECT * FROM fichas_cobro WHERE ficha_id = ?', [fichaId]
      );
      const total = items.reduce((s, i) => s + Number(i.cantidad) * Number(i.precio_unitario), 0);
      res.json({
        success: true,
        data: {
          items,
          total,
          cobrado:    cobro[0]?.cobrado    ?? 0,
          cobrado_at: cobro[0]?.cobrado_at ?? null,
          notas:      cobro[0]?.notas      ?? null,
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Error al obtener comanda', error: err.message });
    }
  },

  // PUT /fichas/:fichaId/comanda  — reemplaza todos los ítems
  async saveComanda(req, res) {
    try {
      const { fichaId } = req.params;
      const items = Array.isArray(req.body.items) ? req.body.items : [];

      const [ficha] = await db.query('SELECT id FROM fichas_medicas WHERE id = ?', [fichaId]);
      if (!ficha.length) return res.status(404).json({ success: false, message: 'Ficha no encontrada' });

      await db.query('DELETE FROM comanda_items WHERE ficha_id = ?', [fichaId]);

      for (const item of items) {
        if (!item.descripcion?.trim()) continue;
        const cantidad = Math.max(0.01, Number(item.cantidad) || 1);
        const precio   = Math.max(0, Number(item.precio_unitario) || 0);
        await db.query(
          'INSERT INTO comanda_items (ficha_id, tipo, servicio_id, descripcion, cantidad, precio_unitario) VALUES (?, ?, ?, ?, ?, ?)',
          [fichaId, item.tipo || 'manual', item.servicio_id || null, item.descripcion.trim(), cantidad, precio]
        );
      }

      const [saved] = await db.query('SELECT * FROM comanda_items WHERE ficha_id = ? ORDER BY id', [fichaId]);
      const total   = saved.reduce((s, i) => s + Number(i.cantidad) * Number(i.precio_unitario), 0);
      res.json({ success: true, data: { items: saved, total } });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Error al guardar comanda', error: err.message });
    }
  },

  // GET /facturacion
  async listFacturacion(req, res) {
    try {
      const { q, cobrado, fecha_desde, fecha_hasta, page = 1, limit = 100 } = req.query;
      const offset = (Number(page) - 1) * Number(limit);

      const conds  = ['ci.cnt > 0'];
      const params = [];

      if (q) {
        conds.push('(p.nombre LIKE ? OR m.nombre LIKE ?)');
        params.push(`%${q}%`, `%${q}%`);
      }
      if (cobrado === '1') conds.push('COALESCE(fc.cobrado, 0) = 1');
      if (cobrado === '0') conds.push('COALESCE(fc.cobrado, 0) = 0');
      if (fecha_desde) { conds.push('DATE(f.fecha) >= ?'); params.push(fecha_desde); }
      if (fecha_hasta) { conds.push('DATE(f.fecha) <= ?'); params.push(fecha_hasta); }

      const where = `WHERE ${conds.join(' AND ')}`;

      const base = `
        FROM fichas_medicas f
        JOIN mascotas m ON f.mascota_id = m.id
        LEFT JOIN propietarios p ON p.id = m.owner_id
        LEFT JOIN fichas_cobro fc ON f.id = fc.ficha_id
        LEFT JOIN usuarios u ON f.uploaded_by = u.id
        JOIN (
          SELECT ficha_id,
                 COUNT(*) AS cnt,
                 SUM(cantidad * precio_unitario) AS total
          FROM comanda_items GROUP BY ficha_id
        ) ci ON ci.ficha_id = f.id
        ${where}
      `;

      const [[{ total: totalRecs }]] = await db.query(`SELECT COUNT(*) AS total ${base}`, params);

      const [rows] = await db.query(
        `SELECT
           f.id, f.tipo, f.tipo_personalizado, f.fecha, f.nota,
           m.nombre AS mascota_nombre, m.especie,
           p.id    AS propietario_id,
           p.nombre   AS propietario_nombre,
           p.telefono AS propietario_telefono,
           u.nombre   AS veterinario_nombre,
           COALESCE(fc.cobrado, 0) AS cobrado,
           fc.cobrado_at, fc.notas AS notas_cobro,
           ci.total AS total_comanda,
           ci.cnt   AS items_count
         ${base}
         ORDER BY f.fecha DESC
         LIMIT ? OFFSET ?`,
        [...params, Number(limit), offset]
      );

      const fichaIds = rows.map(r => r.id);
      let itemsByFicha = {};
      if (fichaIds.length) {
        const [items] = await db.query(
          `SELECT * FROM comanda_items WHERE ficha_id IN (${fichaIds.map(() => '?').join(',')}) ORDER BY ficha_id, id`,
          fichaIds
        );
        for (const item of items) {
          if (!itemsByFicha[item.ficha_id]) itemsByFicha[item.ficha_id] = [];
          itemsByFicha[item.ficha_id].push(item);
        }
      }

      res.json({
        success: true,
        data: rows.map(r => ({ ...r, items: itemsByFicha[r.id] || [] })),
        meta: { total: totalRecs, page: Number(page), limit: Number(limit) },
      });
    } catch (err) {
      console.error('Error listFacturacion:', err);
      res.status(500).json({ success: false, message: 'Error al obtener facturación', error: err.message });
    }
  },

  // PUT /facturacion/:fichaId/cobrar
  async marcarCobrado(req, res) {
    try {
      const { fichaId } = req.params;
      const cobrado = req.body.cobrado !== false && req.body.cobrado !== 0;
      const notas   = req.body.notas || null;
      const userId  = req.user?.userId || req.user?.id || null;

      const [ficha] = await db.query('SELECT id FROM fichas_medicas WHERE id = ?', [fichaId]);
      if (!ficha.length) return res.status(404).json({ success: false, message: 'Ficha no encontrada' });

      await db.query(
        `INSERT INTO fichas_cobro (ficha_id, cobrado, cobrado_at, cobrado_por, notas)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           cobrado     = VALUES(cobrado),
           cobrado_at  = VALUES(cobrado_at),
           cobrado_por = VALUES(cobrado_por),
           notas       = VALUES(notas)`,
        [fichaId, cobrado ? 1 : 0, cobrado ? new Date() : null, cobrado ? userId : null, notas]
      );

      res.json({ success: true, data: { ficha_id: Number(fichaId), cobrado, notas } });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Error al actualizar cobro', error: err.message });
    }
  },
};

module.exports = ComandaController;
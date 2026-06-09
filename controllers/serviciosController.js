// controllers/serviciosController.js
const db = require('../db');

const ServiciosController = {
  async list(req, res) {
    try {
      const all = req.query.all === '1';
      const [rows] = await db.query(
        `SELECT * FROM servicios ${all ? '' : 'WHERE activo = 1'} ORDER BY categoria, nombre`
      );
      res.json({ success: true, data: rows });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Error al listar servicios', error: err.message });
    }
  },

  async create(req, res) {
    try {
      const { nombre, categoria, precio } = req.body;
      if (!nombre?.trim()) return res.status(400).json({ success: false, message: 'nombre requerido' });
      if (precio == null || isNaN(Number(precio))) return res.status(400).json({ success: false, message: 'precio inválido' });
      const [r] = await db.query(
        'INSERT INTO servicios (nombre, categoria, precio) VALUES (?, ?, ?)',
        [nombre.trim(), categoria?.trim() || null, Number(precio)]
      );
      const [rows] = await db.query('SELECT * FROM servicios WHERE id = ?', [r.insertId]);
      res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Error al crear servicio', error: err.message });
    }
  },

  async update(req, res) {
    try {
      const { nombre, categoria, precio, activo } = req.body;
      const [ex] = await db.query('SELECT id FROM servicios WHERE id = ?', [req.params.id]);
      if (!ex.length) return res.status(404).json({ success: false, message: 'Servicio no encontrado' });
      await db.query(
        `UPDATE servicios SET
          nombre   = COALESCE(?, nombre),
          categoria = ?,
          precio   = COALESCE(?, precio),
          activo   = COALESCE(?, activo)
         WHERE id = ?`,
        [nombre?.trim() || null, categoria?.trim() ?? null, precio != null ? Number(precio) : null, activo != null ? (activo ? 1 : 0) : null, req.params.id]
      );
      const [rows] = await db.query('SELECT * FROM servicios WHERE id = ?', [req.params.id]);
      res.json({ success: true, data: rows[0] });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Error al actualizar servicio', error: err.message });
    }
  },

  async remove(req, res) {
    try {
      const [ex] = await db.query('SELECT id FROM servicios WHERE id = ?', [req.params.id]);
      if (!ex.length) return res.status(404).json({ success: false, message: 'Servicio no encontrado' });
      await db.query('UPDATE servicios SET activo = 0 WHERE id = ?', [req.params.id]);
      res.json({ success: true, message: 'Servicio desactivado' });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Error al eliminar servicio', error: err.message });
    }
  },
};

module.exports = ServiciosController;
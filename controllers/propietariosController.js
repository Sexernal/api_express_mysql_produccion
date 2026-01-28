const db = require('../db');

const PropietariosController = {
  async list(req, res) {
    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(100, parseInt(req.query.limit) || 10);
      const q = (req.query.q || '').trim();

      let where = '';
      const params = [];
      if (q) {
        where = ' WHERE nombre LIKE ? OR email LIKE ? OR telefono LIKE ?';
        params.push(`%${q}%`, `%${q}%`, `%${q}%`);
      }

      const [countRows] = await db.query(`SELECT COUNT(*) AS total FROM propietarios ${where}`, params);
      const total = countRows[0]?.total || 0;

      const offset = (page - 1) * limit;
      const [rows] = await db.query(`SELECT * FROM propietarios ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);

      res.set('X-Total-Count', String(total));
      res.json({ success: true, data: rows, meta: { total, page, limit } });
    } catch (error) {
      console.error('Error list propietarios:', error);
      res.status(500).json({ success: false, message: 'Error al listar propietarios', error: error.message });
    }
  },

  async getById(req, res) {
    try {
      const id = req.params.id;
      const [rows] = await db.query('SELECT * FROM propietarios WHERE id = ?', [id]);
      if (!rows.length) return res.status(404).json({ success: false, message: 'Propietario no encontrado' });
      res.json({ success: true, data: rows[0] });
    } catch (error) {
      console.error('Error get propietario:', error);
      res.status(500).json({ success: false, message: 'Error al obtener propietario', error: error.message });
    }
  },

  async create(req, res) {
    try {
      const { nombre, email, telefono, direccion } = req.body;
      // opcional: verificar duplicados
      const [exists] = await db.query('SELECT id FROM propietarios WHERE email = ?', [email]);
      if (exists.length) return res.status(409).json({ success: false, message: 'Email ya registrado' });

      const [result] = await db.query(
        'INSERT INTO propietarios (nombre, email, telefono, direccion) VALUES (?, ?, ?, ?)',
        [nombre, email, telefono || null, direccion || null]
      );
      const [rows] = await db.query('SELECT * FROM propietarios WHERE id = ?', [result.insertId]);
      res.status(201).json({ success: true, data: rows[0] });
    } catch (error) {
      console.error('Error create propietario:', error);
      res.status(500).json({ success: false, message: 'Error al crear propietario', error: error.message });
    }
  },

  async update(req, res) {
    try {
      const id = req.params.id;
      const { nombre, email, telefono, direccion } = req.body;
      // si actualiza email validar duplicado
      if (email) {
        const [rowsEmail] = await db.query('SELECT id FROM propietarios WHERE email = ? AND id != ?', [email, id]);
        if (rowsEmail.length) return res.status(409).json({ success: false, message: 'Email ya en uso por otro propietario' });
      }
      await db.query('UPDATE propietarios SET nombre = COALESCE(?, nombre), email = COALESCE(?, email), telefono = COALESCE(?, telefono), direccion = COALESCE(?, direccion) WHERE id = ?', [nombre, email, telefono, direccion, id]);
      const [rows] = await db.query('SELECT * FROM propietarios WHERE id = ?', [id]);
      res.json({ success: true, data: rows[0] });
    } catch (error) {
      console.error('Error update propietario:', error);
      res.status(500).json({ success: false, message: 'Error al actualizar propietario', error: error.message });
    }
  },

  async remove(req, res) {
    try {
      const id = req.params.id;
      await db.query('DELETE FROM propietarios WHERE id = ?', [id]);
      res.json({ success: true, message: 'Propietario eliminado' });
    } catch (error) {
      console.error('Error delete propietario:', error);
      res.status(500).json({ success: false, message: 'Error al eliminar propietario', error: error.message });
    }
  }
};

module.exports = PropietariosController;
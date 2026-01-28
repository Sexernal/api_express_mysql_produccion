const db = require('../db');

const MascotasController = {
  async list(req, res) {
    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(100, parseInt(req.query.limit) || 10);
      const q = (req.query.q || '').trim();
  
      let where = '';
      const params = [];
      if (q) {
        where = ' WHERE m.nombre LIKE ? OR m.especie LIKE ? OR m.raza LIKE ? OR p.nombre LIKE ?';
        params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
      }
  
      const countSql = `SELECT COUNT(*) AS total FROM mascotas m JOIN propietarios p ON m.owner_id = p.id ${where}`;
      const [countRows] = await db.query(countSql, params);
      const total = countRows[0]?.total || 0;
  
      const offset = (page - 1) * limit;
      const sql = `
        SELECT m.*, p.nombre AS propietario_nombre, p.email AS propietario_email
        FROM mascotas m
        JOIN propietarios p ON m.owner_id = p.id
        ${where}
        ORDER BY m.created_at DESC
        LIMIT ? OFFSET ?
      `;
      const [rows] = await db.query(sql, [...params, limit, offset]);
  
      res.set('X-Total-Count', String(total));
      res.json({ success: true, data: rows, meta: { total, page, limit } });
    } catch (error) {
      console.error('Error list mascotas:', error);
      res.status(500).json({ success: false, message: 'Error al listar mascotas', error: error.message });
    }
  },

  async getById(req, res) {
    try {
      const id = req.params.id;
      const [rows] = await db.query('SELECT * FROM mascotas WHERE id = ?', [id]);
      if (!rows.length) return res.status(404).json({ success: false, message: 'Mascota no encontrada' });
      res.json({ success: true, data: rows[0] });
    } catch (error) {
      console.error('Error get mascota:', error);
      res.status(500).json({ success: false, message: 'Error al obtener mascota', error: error.message });
    }
  },

  async create(req, res) {
    try {
      const { nombre, especie, raza, edad, historial_medico, owner_id } = req.body;
      // validar que propietario exista
      const [owner] = await db.query('SELECT id FROM propietarios WHERE id = ?', [owner_id]);
      if (!owner.length) return res.status(400).json({ success: false, message: 'Propietario no existe' });
      const [result] = await db.query(
        'INSERT INTO mascotas (nombre, especie, raza, edad, historial_medico, owner_id) VALUES (?, ?, ?, ?, ?, ?)',
        [nombre, especie || null, raza || null, edad || null, historial_medico || null, owner_id]
      );
      const [rows] = await db.query('SELECT * FROM mascotas WHERE id = ?', [result.insertId]);
      res.status(201).json({ success: true, data: rows[0] });
    } catch (error) {
      console.error('Error create mascota:', error);
      res.status(500).json({ success: false, message: 'Error al crear mascota', error: error.message });
    }
  },

  async update(req, res) {
    try {
      const id = req.params.id;
      const { nombre, especie, raza, edad, historial_medico, owner_id } = req.body;
      if (owner_id) {
        const [owner] = await db.query('SELECT id FROM propietarios WHERE id = ?', [owner_id]);
        if (!owner.length) return res.status(400).json({ success: false, message: 'Propietario no existe' });
      }
      await db.query(
        'UPDATE mascotas SET nombre = COALESCE(?, nombre), especie = COALESCE(?, especie), raza = COALESCE(?, raza), edad = COALESCE(?, edad), historial_medico = COALESCE(?, historial_medico), owner_id = COALESCE(?, owner_id) WHERE id = ?',
        [nombre, especie, raza, edad, historial_medico, owner_id, id]
      );
      const [rows] = await db.query('SELECT * FROM mascotas WHERE id = ?', [id]);
      res.json({ success: true, data: rows[0] });
    } catch (error) {
      console.error('Error update mascota:', error);
      res.status(500).json({ success: false, message: 'Error al actualizar mascota', error: error.message });
    }
  },

  async remove(req, res) {
    try {
      const id = req.params.id;
      await db.query('DELETE FROM mascotas WHERE id = ?', [id]);
      res.json({ success: true, message: 'Mascota eliminada' });
    } catch (error) {
      console.error('Error delete mascota:', error);
      res.status(500).json({ success: false, message: 'Error al eliminar mascota', error: error.message });
    }
  }
};

module.exports = MascotasController;
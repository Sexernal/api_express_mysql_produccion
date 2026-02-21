// controllers/mascotasController.js
const db = require('../db');

const MascotasController = {
  async list(req, res) {
    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(100, parseInt(req.query.limit) || 10);
      const q = (req.query.q || '').trim();

      // Construimos filtros de forma segura y ordenada
      const filters = [];
      const params = [];

      // Si es propietario autenticado: forzamos filtro por su owner_id
      if (req.user && req.user.role === 'propietario') {
        filters.push('m.owner_id = ?');
        params.push(Number(req.user.userId));
      } else {
        // Si no es propietario (admin u otro), permitimos filtrar por query owner_id si viene
        if (req.query.owner_id) {
          const ownerId = parseInt(req.query.owner_id);
          if (!isNaN(ownerId)) {
            filters.push('m.owner_id = ?');
            params.push(ownerId);
          }
        }
      }

      // Filtro de búsqueda por q (nombre, especie, raza, propietario)
      if (q) {
        filters.push('(m.nombre LIKE ? OR m.especie LIKE ? OR m.raza LIKE ? OR p.nombre LIKE ?)');
        params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
      }

      const where = filters.length ? ' WHERE ' + filters.join(' AND ') : '';

      // Contar total (con los mismos filtros)
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
      // Nota: agregamos limit y offset al final de los parámetros
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

      const mascota = rows[0];

      // Si el solicitante es propietario, verificar que la mascota le pertenezca
      if (req.user && req.user.role === 'propietario') {
        if (Number(mascota.owner_id) !== Number(req.user.userId)) {
          return res.status(403).json({
            success: false,
            message: 'No autorizado para ver esta mascota',
            error: 'La mascota no pertenece al propietario autenticado'
          });
        }
      }

      res.json({ success: true, data: mascota });
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
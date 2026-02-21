// controllers/propietariosController.js
const db = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

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
      const [rows] = await db.query(
        `SELECT * FROM propietarios ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );

      // No devolver password
      const safe = rows.map(r => {
        const { password, ...rest } = r;
        return rest;
      });

      res.set('X-Total-Count', String(total));
      res.json({ success: true, data: safe, meta: { total, page, limit } });
    } catch (error) {
      console.error('Error list propietarios:', error);
      res.status(500).json({ success: false, message: 'Error al listar propietarios', error: error.message });
    }
  },

  // GET /propietarios/me
  async getMe(req, res) {
    try {
      const id = req.user && req.user.userId;
      if (!id) return res.status(401).json({ success: false, message: 'No autenticado' });

      const [rows] = await db.query('SELECT id, nombre, email, telefono, direccion, created_at, updated_at FROM propietarios WHERE id = ?', [id]);
      if (!rows.length) return res.status(404).json({ success: false, message: 'Propietario no encontrado' });

      res.json({ success: true, data: rows[0] });
    } catch (error) {
      console.error('Error getMe propietario:', error);
      res.status(500).json({ success: false, message: 'Error al obtener propietario', error: error.message });
    }
  },

  async getById(req, res) {
    try {
      const id = req.params.id;
      const [rows] = await db.query('SELECT * FROM propietarios WHERE id = ?', [id]);
      if (!rows.length) return res.status(404).json({ success: false, message: 'Propietario no encontrado' });

      const { password, ...safe } = rows[0];
      res.json({ success: true, data: safe });
    } catch (error) {
      console.error('Error get propietario:', error);
      res.status(500).json({ success: false, message: 'Error al obtener propietario', error: error.message });
    }
  },

  async create(req, res) {
    try {
      const { nombre, email, telefono, direccion, password } = req.body;

      // validar requeridos mínimos (routes ya valida, igual comprobación extra)
      if (!nombre || !email) return res.status(400).json({ success: false, message: 'nombre y email requeridos' });

      const [exists] = await db.query('SELECT id FROM propietarios WHERE email = ?', [email]);
      if (exists.length) return res.status(409).json({ success: false, message: 'Email ya registrado' });

      let hashed = null;
      if (password) {
        // hash password si se envía
        const saltRounds = 10;
        hashed = await bcrypt.hash(password, saltRounds);
      }

      const [result] = await db.query(
        'INSERT INTO propietarios (nombre, email, telefono, direccion, password) VALUES (?, ?, ?, ?, ?)',
        [nombre, email, telefono || null, direccion || null, hashed]
      );

      const [rows] = await db.query('SELECT * FROM propietarios WHERE id = ?', [result.insertId]);
      const { password: pwd, ...safe } = rows[0];

      res.status(201).json({ success: true, data: safe });
    } catch (error) {
      console.error('Error create propietario:', error);
      res.status(500).json({ success: false, message: 'Error al crear propietario', error: error.message });
    }
  },

  // PUT /propietarios/me  <-- nuevo: permite que el propietario autenticado actualice su propia info
  async updateMe(req, res) {
    try {
      const id = req.user && req.user.userId;
      if (!id) return res.status(401).json({ success: false, message: 'No autenticado' });

      const { nombre, email, telefono, direccion, password } = req.body;

      // si actualiza email validar duplicado
      if (email) {
        const [rowsEmail] = await db.query('SELECT id FROM propietarios WHERE email = ? AND id != ?', [email, id]);
        if (rowsEmail.length) return res.status(409).json({ success: false, message: 'Email ya en uso por otro propietario' });
      }

      let hashed;
      if (typeof password !== 'undefined' && password !== null && password !== '') {
        const saltRounds = 10;
        hashed = await bcrypt.hash(password, saltRounds);
      }

      // Update dinámico con COALESCE (no tocará campos no enviados)
      await db.query(
        `UPDATE propietarios SET
           nombre = COALESCE(?, nombre),
           email = COALESCE(?, email),
           telefono = COALESCE(?, telefono),
           direccion = COALESCE(?, direccion),
           updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [nombre, email, telefono, direccion, id]
      );

      if (typeof hashed !== 'undefined') {
        await db.query('UPDATE propietarios SET password = ? WHERE id = ?', [hashed, id]);
      }

      const [rows] = await db.query('SELECT id, nombre, email, telefono, direccion, created_at, updated_at FROM propietarios WHERE id = ?', [id]);
      if (!rows.length) return res.status(404).json({ success: false, message: 'Propietario no encontrado tras actualización' });

      res.json({ success: true, data: rows[0] });
    } catch (error) {
      console.error('Error updateMe propietario:', error);
      res.status(500).json({ success: false, message: 'Error al actualizar propietario', error: error.message });
    }
  },

  async update(req, res) {
    try {
      const id = req.params.id;
      const { nombre, email, telefono, direccion, password } = req.body;

      // verificar existencia
      const [target] = await db.query('SELECT * FROM propietarios WHERE id = ?', [id]);
      if (!target.length) return res.status(404).json({ success: false, message: 'Propietario no encontrado' });

      // si actualiza email validar duplicado
      if (email) {
        const [rowsEmail] = await db.query('SELECT id FROM propietarios WHERE email = ? AND id != ?', [email, id]);
        if (rowsEmail.length) return res.status(409).json({ success: false, message: 'Email ya en uso por otro propietario' });
      }

      let hashed = undefined;
      if (typeof password !== 'undefined' && password !== null && password !== '') {
        // si enviaron password vacía string -> validar (routes debería evitarlo). Aqui solo hash si viene no vacío.
        const saltRounds = 10;
        hashed = await bcrypt.hash(password, saltRounds);
      }

      // construir query con COALESCE para no sobreescribir si no viene campo
      await db.query(
        `UPDATE propietarios SET
           nombre = COALESCE(?, nombre),
           email = COALESCE(?, email),
           telefono = COALESCE(?, telefono),
           direccion = COALESCE(?, direccion)
         WHERE id = ?`,
        [nombre, email, telefono, direccion, id]
      );

      // si hay password nuevo, actualizarlo aparte (para evitar COALESCE con NULL)
      if (typeof hashed !== 'undefined') {
        await db.query('UPDATE propietarios SET password = ? WHERE id = ?', [hashed, id]);
      }

      const [rows] = await db.query('SELECT * FROM propietarios WHERE id = ?', [id]);
      const { password: pwd, ...safe } = rows[0];

      res.json({ success: true, data: safe });
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
  },

  // Nuevo: login para propietarios (para app móvil)
  async login(req, res) {
    try {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ success: false, message: 'Email y contraseña son requeridos' });

      const [rows] = await db.query('SELECT * FROM propietarios WHERE email = ?', [email]);
      if (!rows.length) return res.status(401).json({ success: false, message: 'Credenciales inválidas' });

      const user = rows[0];
      if (!user.password) return res.status(401).json({ success: false, message: 'Credenciales inválidas' });

      const isValid = await bcrypt.compare(password, user.password);
      if (!isValid) return res.status(401).json({ success: false, message: 'Credenciales inválidas' });

      // Generar token JWT (payload similar a usuarios => userId + email + role)
      const payload = {
        userId: user.id,
        email: user.email,
        role: 'propietario'
      };
      const token = jwt.sign(payload, process.env.JWT_SECRET || 'default_secret_key', { expiresIn: process.env.JWT_EXPIRES_IN || '24h' });

      const safeUser = {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        telefono: user.telefono,
        direccion: user.direccion,
        created_at: user.created_at || null
      };

      // Mantengo el formato de respuesta que ya tenías: data: { user, token, expiresIn }
      res.status(200).json({ success: true, message: 'Login exitoso', data: { user: safeUser, token, expiresIn: process.env.JWT_EXPIRES_IN || '24h' } });
    } catch (err) {
      console.error('Error login propietario:', err);
      res.status(500).json({ success: false, message: 'Error interno', error: err.message });
    }
  }
};

module.exports = PropietariosController;
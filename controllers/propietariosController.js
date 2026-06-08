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
        where = ' WHERE nombre LIKE ? OR email LIKE ? OR telefono LIKE ? OR cedula LIKE ?';
        params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
      }

      const [countRows] = await db.query(`SELECT COUNT(*) AS total FROM propietarios ${where}`, params);
      const total = countRows[0]?.total || 0;

      const offset = (page - 1) * limit;
      const [rows] = await db.query(
        `SELECT * FROM propietarios ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );

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

  async getMe(req, res) {
    try {
      const id = req.user && req.user.userId;
      if (!id) return res.status(401).json({ success: false, message: 'No autenticado' });

      const [rows] = await db.query(
        'SELECT id, cedula, nombre, email, telefono, direccion, created_at, updated_at FROM propietarios WHERE id = ?',
        [id]
      );
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
      const { nombre, email, telefono, direccion, password, cedula } = req.body;

      if (!nombre || !email) {
        return res.status(400).json({ success: false, message: 'nombre y email requeridos' });
      }

      // Verificar unicidad de email
      const [existsEmail] = await db.query('SELECT id FROM propietarios WHERE email = ?', [email]);
      if (existsEmail.length) {
        return res.status(409).json({ success: false, message: 'Email ya registrado' });
      }

      // Verificar unicidad de cédula (si se proporcionó)
      if (cedula) {
        if (!/^\d{9}$/.test(cedula)) {
          return res.status(400).json({ success: false, message: 'Cédula debe tener exactamente 9 dígitos numéricos' });
        }
        const [existsCedula] = await db.query('SELECT id FROM propietarios WHERE cedula = ?', [cedula]);
        if (existsCedula.length) {
          return res.status(409).json({ success: false, message: 'Cédula ya registrada' });
        }
      }

      let hashed = null;
      if (password) {
        hashed = await bcrypt.hash(password, 10);
      }

      const [result] = await db.query(
        'INSERT INTO propietarios (cedula, nombre, email, telefono, direccion, password) VALUES (?, ?, ?, ?, ?, ?)',
        [cedula || null, nombre, email, telefono || null, direccion || null, hashed]
      );

      const [rows] = await db.query('SELECT * FROM propietarios WHERE id = ?', [result.insertId]);
      const { password: pwd, ...safe } = rows[0];

      res.status(201).json({ success: true, data: safe });
    } catch (error) {
      console.error('Error create propietario:', error.code, error.message);
      res.status(500).json({ success: false, message: 'Error al crear propietario', error: error.message });
    }
  },

  async updateMe(req, res) {
    try {
      const id = req.user && req.user.userId;
      if (!id) return res.status(401).json({ success: false, message: 'No autenticado' });

      const { nombre, email, telefono, direccion, password } = req.body;

      if (email) {
        const [rowsEmail] = await db.query('SELECT id FROM propietarios WHERE email = ? AND id != ?', [email, id]);
        if (rowsEmail.length) {
          return res.status(409).json({ success: false, message: 'Email ya en uso por otro propietario' });
        }
      }

      let hashed;
      if (password) {
        hashed = await bcrypt.hash(password, 10);
      }

      await db.query(
        `UPDATE propietarios SET
           nombre    = COALESCE(?, nombre),
           email     = COALESCE(?, email),
           telefono  = COALESCE(?, telefono),
           direccion = COALESCE(?, direccion),
           updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [nombre || null, email || null, telefono || null, direccion || null, id]
      );

      if (hashed) {
        await db.query('UPDATE propietarios SET password = ? WHERE id = ?', [hashed, id]);
      }

      const [rows] = await db.query(
        'SELECT id, cedula, nombre, email, telefono, direccion, created_at, updated_at FROM propietarios WHERE id = ?',
        [id]
      );
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
      // Nota: cedula NO se incluye aquí — es inmutable una vez asignada.

      const [target] = await db.query('SELECT * FROM propietarios WHERE id = ?', [id]);
      if (!target.length) return res.status(404).json({ success: false, message: 'Propietario no encontrado' });

      if (email) {
        const [rowsEmail] = await db.query('SELECT id FROM propietarios WHERE email = ? AND id != ?', [email, id]);
        if (rowsEmail.length) {
          return res.status(409).json({ success: false, message: 'Email ya en uso por otro propietario' });
        }
      }

      let hashed;
      if (password) {
        hashed = await bcrypt.hash(password, 10);
      }

      await db.query(
        `UPDATE propietarios SET
           nombre    = COALESCE(?, nombre),
           email     = COALESCE(?, email),
           telefono  = COALESCE(?, telefono),
           direccion = COALESCE(?, direccion)
         WHERE id = ?`,
        [nombre || null, email || null, telefono || null, direccion || null, id]
      );

      if (hashed) {
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

  // Login para propietarios — soporta cédula (app móvil) o email (legado)
  async login(req, res) {
    try {
      const { cedula, email, password } = req.body;

      if (!password || (!cedula && !email)) {
        return res.status(400).json({ success: false, message: 'Credenciales requeridas (cédula o email, más contraseña)' });
      }

      let rows;
      if (cedula) {
        [rows] = await db.query('SELECT * FROM propietarios WHERE cedula = ?', [cedula]);
      } else {
        [rows] = await db.query('SELECT * FROM propietarios WHERE email = ?', [email]);
      }

      if (!rows.length) return res.status(401).json({ success: false, message: 'Credenciales inválidas' });

      const user = rows[0];
      if (!user.password) return res.status(401).json({ success: false, message: 'Este propietario no tiene contraseña configurada' });

      const isValid = await bcrypt.compare(password, user.password);
      if (!isValid) return res.status(401).json({ success: false, message: 'Credenciales inválidas' });

      const payload = {
        userId: user.id,
        cedula: user.cedula,
        email:  user.email,
        role:   'propietario',
      };
      const token = jwt.sign(payload, process.env.JWT_SECRET || 'default_secret_key', {
        expiresIn: process.env.JWT_EXPIRES_IN || '24h',
      });

      const safeUser = {
        id:         user.id,
        cedula:     user.cedula,
        nombre:     user.nombre,
        email:      user.email,
        telefono:   user.telefono,
        direccion:  user.direccion,
        created_at: user.created_at || null,
      };

      res.status(200).json({
        success: true,
        message: 'Login exitoso',
        data: { user: safeUser, token, expiresIn: process.env.JWT_EXPIRES_IN || '24h' },
      });
    } catch (err) {
      console.error('Error login propietario:', err);
      res.status(500).json({ success: false, message: 'Error interno', error: err.message });
    }
  },
};

module.exports = PropietariosController;
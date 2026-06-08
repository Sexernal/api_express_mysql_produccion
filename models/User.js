const { pool } = require('../config/database');

const BASE_FIELDS = `id, cedula, nombre, email, telefono, role, especialidad, direccion,
  fecha_creacion AS created_at, fecha_actualizacion AS updated_at`;

class User {
  static async findAll() {
    try {
      const [rows] = await pool.execute(
        `SELECT ${BASE_FIELDS} FROM usuarios ORDER BY fecha_creacion DESC`
      );
      return rows;
    } catch (error) {
      console.error('Error en User.findAll:', error);
      throw new Error('Error al obtener usuarios');
    }
  }

  static async findById(id) {
    try {
      const [rows] = await pool.execute(
        `SELECT ${BASE_FIELDS} FROM usuarios WHERE id = ?`,
        [id]
      );
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('Error en User.findById:', error);
      throw new Error('Error al buscar usuario por ID');
    }
  }

  static async findByIdWithPassword(id) {
    try {
      const [rows] = await pool.execute(
        'SELECT * FROM usuarios WHERE id = ?',
        [id]
      );
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('Error en User.findByIdWithPassword:', error);
      throw new Error('Error al buscar usuario por ID');
    }
  }

  static async findByEmail(email) {
    try {
      const [rows] = await pool.execute(
        `SELECT ${BASE_FIELDS} FROM usuarios WHERE email = ?`,
        [email]
      );
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('Error en User.findByEmail:', error);
      throw new Error('Error al buscar usuario por email');
    }
  }

  static async findByEmailWithPassword(email) {
    try {
      const [rows] = await pool.execute(
        'SELECT * FROM usuarios WHERE email = ?',
        [email]
      );
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('Error en User.findByEmailWithPassword:', error);
      throw new Error('Error al buscar usuario por email');
    }
  }

  static async findByCedula(cedula) {
    try {
      const [rows] = await pool.execute(
        `SELECT ${BASE_FIELDS} FROM usuarios WHERE cedula = ?`,
        [cedula]
      );
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('Error en User.findByCedula:', error);
      throw new Error('Error al buscar usuario por cédula');
    }
  }

  static async findByCedulaWithPassword(cedula) {
    try {
      const [rows] = await pool.execute(
        'SELECT * FROM usuarios WHERE cedula = ?',
        [cedula]
      );
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('Error en User.findByCedulaWithPassword:', error);
      throw new Error('Error al buscar usuario por cédula');
    }
  }

  static async create(userData) {
    try {
      const {
        cedula = null,
        nombre,
        email,
        telefono,
        password,
        role = 'user',
        especialidad = null,
        direccion = null,
      } = userData;

      // Valores provisionales para columnas NOT NULL cuando solo se tiene la cédula
      const nombreVal   = nombre   || cedula || 'Pendiente';
      const emailVal    = email    || (cedula ? `${cedula}@pendiente.vet` : null);
      const telefonoVal = telefono || '00000000';

      const [result] = await pool.execute(
        `INSERT INTO usuarios
           (cedula, nombre, email, telefono, password, role, especialidad, direccion,
            fecha_creacion, fecha_actualizacion)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [cedula, nombreVal, emailVal, telefonoVal, password, role, especialidad, direccion]
      );

      return await this.findById(result.insertId);
    } catch (error) {
      console.error('DB error in User.create:', error.code, error.message);
      if (error.code === 'ER_DUP_ENTRY') {
        if (error.message.includes('cedula') || error.message.includes('uk_usuarios_cedula')) {
          throw new Error('La cédula ya está registrada');
        }
        throw new Error('El email ya está registrado');
      }
      throw new Error('Error al crear usuario');
    }
  }

  static async update(id, userData) {
    try {
      const { nombre, email, telefono, password, role, especialidad, direccion } = userData;

      let query = 'UPDATE usuarios SET fecha_actualizacion = NOW()';
      const params = [];

      if (nombre      !== undefined) { query += ', nombre = ?';       params.push(nombre); }
      if (email       !== undefined) { query += ', email = ?';        params.push(email); }
      if (telefono    !== undefined) { query += ', telefono = ?';     params.push(telefono); }
      if (role        !== undefined) { query += ', role = ?';         params.push(role); }
      if (especialidad !== undefined) { query += ', especialidad = ?'; params.push(especialidad); }
      if (direccion   !== undefined) { query += ', direccion = ?';    params.push(direccion); }
      if (password)                  { query += ', password = ?';     params.push(password); }

      query += ' WHERE id = ?';
      params.push(id);

      const [result] = await pool.execute(query, params);
      if (result.affectedRows === 0) return null;

      return await this.findById(id);
    } catch (error) {
      console.error('Error en User.update:', error);
      if (error.code === 'ER_DUP_ENTRY') {
        throw new Error('El email ya está registrado');
      }
      throw new Error('Error al actualizar usuario');
    }
  }

  static async delete(id) {
    try {
      const [result] = await pool.execute('DELETE FROM usuarios WHERE id = ?', [id]);
      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error en User.delete:', error);
      throw new Error('Error al eliminar usuario');
    }
  }

  static async searchByName(nombre) {
    try {
      const [rows] = await pool.execute(
        `SELECT ${BASE_FIELDS} FROM usuarios WHERE nombre LIKE ? ORDER BY nombre`,
        [`%${nombre}%`]
      );
      return rows;
    } catch (error) {
      console.error('Error en User.searchByName:', error);
      throw new Error('Error al buscar usuarios por nombre');
    }
  }

  static async count() {
    try {
      const [rows] = await pool.execute('SELECT COUNT(*) as total FROM usuarios');
      return rows[0].total;
    } catch (error) {
      console.error('Error en User.count:', error);
      throw new Error('Error al contar usuarios');
    }
  }

  static async paginate(page = 1, limit = 10) {
    try {
      let pageInt  = parseInt(page)  || 1;
      let limitInt = parseInt(limit) || 10;
      if (pageInt  < 1)   pageInt  = 1;
      if (limitInt < 1)   limitInt = 10;
      if (limitInt > 100) limitInt = 100;
      const offset = (pageInt - 1) * limitInt;

      const [users] = await pool.query(
        `SELECT ${BASE_FIELDS} FROM usuarios ORDER BY fecha_creacion DESC LIMIT ? OFFSET ?`,
        [limitInt, offset]
      );

      const total      = await this.count();
      const totalPages = Math.ceil(total / limitInt);

      return {
        users,
        pagination: {
          currentPage: pageInt,
          totalPages,
          totalUsers: total,
          hasNextPage: pageInt < totalPages,
          hasPrevPage: pageInt > 1,
          limit: limitInt,
        },
      };
    } catch (error) {
      console.error('Error en User.paginate:', error);
      throw new Error('Error al paginar usuarios');
    }
  }
}

module.exports = User;
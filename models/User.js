/**
 * Modelo de Usuario
 * @description Maneja todas las operaciones CRUD para la entidad Usuario
 */

const { pool } = require('../config/database');

class User {
  constructor(userData) {
    this.id = userData.id;
    this.nombre = userData.nombre;
    this.email = userData.email;
    this.telefono = userData.telefono;
    this.password = userData.password;
    this.role = userData.role;
    // soporte para distintas convenciones de nombres de columna
    this.created_at = userData.created_at || userData.fecha_creacion || null;
    this.updated_at = userData.updated_at || userData.fecha_actualizacion || null;
  }

  static async findAll() {
    try {
      const [rows] = await pool.execute(
        'SELECT id, nombre, email, telefono, role, fecha_creacion AS created_at, fecha_actualizacion AS updated_at FROM usuarios ORDER BY fecha_creacion DESC'
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
        'SELECT id, nombre, email, telefono, role, fecha_creacion AS created_at, fecha_actualizacion AS updated_at FROM usuarios WHERE id = ?',
        [id]
      );
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('Error en User.findById:', error);
      throw new Error('Error al buscar usuario por ID');
    }
  }

  static async findByEmail(email) {
    try {
      const [rows] = await pool.execute(
        'SELECT id, nombre, email, telefono, role, fecha_creacion AS created_at, fecha_actualizacion AS updated_at FROM usuarios WHERE email = ?',
        [email]
      );
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('Error en User.findByEmail:', error);
      throw new Error('Error al buscar usuario por email');
    }
  }

  static async create(userData) {
    try {
      // aceptar role si viene, si no default a 'user'
      const { nombre, email, telefono, password } = userData;
      const role = userData.role || 'user';

      const [result] = await pool.execute(
        'INSERT INTO usuarios (nombre, email, telefono, password, role, fecha_creacion, fecha_actualizacion) VALUES (?, ?, ?, ?, ?, NOW(), NOW())',
        [nombre, email, telefono, password, role]
      );

      // Obtener el usuario recién creado (sin contraseña)
      const newUser = await this.findById(result.insertId);
      if (newUser && newUser.password) {
        delete newUser.password;
      }
      return newUser;
    } catch (error) {
      console.error('Error en User.create:', error);
      if (error.code === 'ER_DUP_ENTRY') {
        throw new Error('El email ya está registrado');
      }
      throw new Error('Error al crear usuario');
    }
  }

  static async update(id, userData) {
    try {
      const { nombre, email, telefono, password, role } = userData;

      let query = 'UPDATE usuarios SET nombre = ?, email = ?, telefono = ?, fecha_actualizacion = NOW()';
      let params = [nombre, email, telefono];

      if (typeof role !== 'undefined') {
        query += ', role = ?';
        params.push(role);
      }

      if (password) {
        query += ', password = ?';
        params.push(password);
      }

      query += ' WHERE id = ?';
      params.push(id);

      const [result] = await pool.execute(query, params);

      if (result.affectedRows === 0) {
        return null;
      }

      const updatedUser = await this.findById(id);
      if (updatedUser && updatedUser.password) delete updatedUser.password;
      return updatedUser;
    } catch (error) {
      console.error('Error en User.update:', error);
      if (error.code === 'ER_DUP_ENTRY') {
        throw new Error('El email ya está registrado');
      }
      throw new Error('Error al actualizar usuario');
    }
  }

  static async findByEmailWithPassword(email) {
    try {
      // devolver * porque necesitamos password para login
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

  static async delete(id) {
    try {
      const [result] = await pool.execute(
        'DELETE FROM usuarios WHERE id = ?',
        [id]
      );
      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error en User.delete:', error);
      throw new Error('Error al eliminar usuario');
    }
  }

  static async searchByName(nombre) {
    try {
      const [rows] = await pool.execute(
        'SELECT id, nombre, email, telefono, role, fecha_creacion AS created_at, fecha_actualizacion AS updated_at FROM usuarios WHERE nombre LIKE ? ORDER BY nombre',
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
      let pageInt = parseInt(page) || 1;
      let limitInt = parseInt(limit) || 10;
      if (pageInt < 1) pageInt = 1;
      if (limitInt < 1) limitInt = 10;
      if (limitInt > 100) limitInt = 100;
      const offset = (pageInt - 1) * limitInt;

      const [users] = await pool.execute(
        `SELECT id, nombre, email, telefono, role, fecha_creacion AS created_at, fecha_actualizacion AS updated_at FROM usuarios ORDER BY fecha_creacion DESC LIMIT ? OFFSET ?`,
        [limitInt, offset]
      );

      const total = await this.count();
      const totalPages = Math.ceil(total / limitInt);

      return {
        users,
        pagination: {
          currentPage: pageInt,
          totalPages,
          totalUsers: total,
          hasNextPage: pageInt < totalPages,
          hasPrevPage: pageInt > 1,
          limit: limitInt
        }
      };
    } catch (error) {
      console.error('Error en User.paginate:', error);
      throw new Error('Error al paginar usuarios');
    }
  }
}

module.exports = User;
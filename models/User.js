/**
 * Modelo de Usuario
 * @description Maneja todas las operaciones CRUD para la entidad Usuario
 */

const { pool } = require('../config/database');

/**
 * Clase que representa el modelo de Usuario
 */
class User {
    /**
     * Constructor para crear una instancia de Usuario
     * @param {Object} userData - Datos del usuario
     * @param {number} userData.id - ID del usuario
     * @param {string} userData.nombre - Nombre del usuario
     * @param {string} userData.email - Email del usuario
     * @param {string} userData.telefono - Teléfono del usuario
     * @param {string} userData.password - Contraseña hasheada del usuario
     * @param {Date} userData.fecha_creacion - Fecha de creación
     * @param {Date} userData.fecha_actualizacion - Fecha de actualización
     */
    constructor(userData) {
        this.id = userData.id;
        this.nombre = userData.nombre;
        this.email = userData.email;
        this.telefono = userData.telefono;
        this.password = userData.password;
        this.fecha_creacion = userData.fecha_creacion;
        this.fecha_actualizacion = userData.fecha_actualizacion;
    }

    /**
     * Obtiene todos los usuarios de la base de datos
     * @returns {Promise<Array>} Array de usuarios
     */
    static async findAll() {
        try {
            const [rows] = await pool.execute(
                'SELECT id, nombre, email, telefono, fecha_creacion, fecha_actualizacion FROM usuarios ORDER BY fecha_creacion DESC'
            );
            return rows;
        } catch (error) {
            console.error('Error en User.findAll:', error);
            throw new Error('Error al obtener usuarios');
        }
    }

    /**
     * Busca un usuario por su ID
     * @param {number} id - ID del usuario
     * @returns {Promise<Object|null>} Usuario encontrado o null
     */
    static async findById(id) {
        try {
            const [rows] = await pool.execute(
                'SELECT id, nombre, email, telefono, fecha_creacion, fecha_actualizacion FROM usuarios WHERE id = ?',
                [id]
            );
            return rows.length > 0 ? rows[0] : null;
        } catch (error) {
            console.error('Error en User.findById:', error);
            throw new Error('Error al buscar usuario por ID');
        }
    }

    /**
     * Busca un usuario por su email
     * @param {string} email - Email del usuario
     * @returns {Promise<Object|null>} Usuario encontrado o null
     */
    static async findByEmail(email) {
        try {
            const [rows] = await pool.execute(
                'SELECT id, nombre, email, telefono, fecha_creacion, fecha_actualizacion FROM usuarios WHERE email = ?',
                [email]
            );
            return rows.length > 0 ? rows[0] : null;
        } catch (error) {
            console.error('Error en User.findByEmail:', error);
            throw new Error('Error al buscar usuario por email');
        }
    }

    /**
     * Crea un nuevo usuario en la base de datos
     * @param {Object} userData - Datos del usuario
     * @param {string} userData.nombre - Nombre del usuario
     * @param {string} userData.email - Email del usuario
     * @param {string} userData.telefono - Teléfono del usuario
     * @param {string} userData.password - Contraseña hasheada del usuario
     * @returns {Promise<Object>} Usuario creado
     */
    static async create(userData) {
        try {
            const { nombre, email, telefono, password } = userData;
            
            const [result] = await pool.execute(
                'INSERT INTO usuarios (nombre, email, telefono, password, fecha_creacion, fecha_actualizacion) VALUES (?, ?, ?, ?, NOW(), NOW())',
                [nombre, email, telefono, password]
            );

            // Obtener el usuario recién creado (sin contraseña)
            const newUser = await this.findById(result.insertId);
            if (newUser) {
                delete newUser.password; // No devolver la contraseña
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

    /**
     * Actualiza un usuario existente
     * @param {number} id - ID del usuario
     * @param {Object} userData - Datos a actualizar
     * @returns {Promise<Object|null>} Usuario actualizado o null
     */
    static async update(id, userData) {
        try {
            const { nombre, email, telefono, password } = userData;
            
            let query = 'UPDATE usuarios SET nombre = ?, email = ?, telefono = ?, fecha_actualizacion = NOW()';
            let params = [nombre, email, telefono];
            
            // Si se proporciona una nueva contraseña, incluirla en la actualización
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

            // Obtener el usuario actualizado (sin contraseña)
            const updatedUser = await this.findById(id);
            if (updatedUser) {
                delete updatedUser.password;
            }
            return updatedUser;
        } catch (error) {
            console.error('Error en User.update:', error);
            if (error.code === 'ER_DUP_ENTRY') {
                throw new Error('El email ya está registrado');
            }
            throw new Error('Error al actualizar usuario');
        }
    }

    /**
     * Busca un usuario por email para autenticación (incluye password)
     * @param {string} email - Email del usuario
     * @returns {Promise<Object|null>} Usuario encontrado con password o null
     */
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

    /**
     * Elimina un usuario por su ID
     * @param {number} id - ID del usuario
     * @returns {Promise<boolean>} True si se eliminó correctamente
     */
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

    /**
     * Busca usuarios por nombre (búsqueda parcial)
     * @param {string} nombre - Nombre a buscar
     * @returns {Promise<Array>} Array de usuarios encontrados
     */
    static async searchByName(nombre) {
        try {
            const [rows] = await pool.execute(
                'SELECT id, nombre, email, telefono, fecha_creacion, fecha_actualizacion FROM usuarios WHERE nombre LIKE ? ORDER BY nombre',
                [`%${nombre}%`]
            );
            return rows;
        } catch (error) {
            console.error('Error en User.searchByName:', error);
            throw new Error('Error al buscar usuarios por nombre');
        }
    }

    /**
     * Cuenta el total de usuarios
     * @returns {Promise<number>} Número total de usuarios
     */
    static async count() {
        try {
            const [rows] = await pool.execute('SELECT COUNT(*) as total FROM usuarios');
            return rows[0].total;
        } catch (error) {
            console.error('Error en User.count:', error);
            throw new Error('Error al contar usuarios');
        }
    }

    /**
     * Obtiene usuarios con paginación
     * @param {number} page - Número de página (empezando en 1)
     * @param {number} limit - Límite de usuarios por página
     * @returns {Promise<Object>} Objeto con usuarios y metadatos de paginación
     */
    static async paginate(page = 1, limit = 10) {
        try {
            // Asegurar que page y limit sean números enteros
            const pageInt = parseInt(page) || 1;
            const limitInt = parseInt(limit) || 10;
            const offset = (pageInt - 1) * limitInt;
            
            // Validar parámetros
            if (pageInt < 1) pageInt = 1;
            if (limitInt < 1) limitInt = 10;
            if (limitInt > 100) limitInt = 100; // Límite máximo
            
            // Obtener usuarios paginados usando interpolación directa
            const [users] = await pool.execute(
                `SELECT id, nombre, email, telefono, fecha_creacion, fecha_actualizacion FROM usuarios ORDER BY fecha_creacion DESC LIMIT ${limitInt} OFFSET ${offset}`
            );

            // Obtener total de usuarios
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
            console.error('Detalles del error:', error.stack);
            throw new Error('Error al paginar usuarios');
        }
    }
}

module.exports = User;
-- ===================================================================
-- Script de Creación de Base de Datos - Sistema de Usuarios
-- ===================================================================
-- Descripción: Script para crear la base de datos y tabla de usuarios
-- Autor: Tu Nombre
-- Fecha: 2024
-- Versión: 1.0.0
-- ===================================================================

-- Crear base de datos si no existe
CREATE DATABASE IF NOT EXISTS usuarios_db
CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;

-- Usar la base de datos
USE usuarios_db;

-- ===================================================================
-- TABLA: usuarios
-- ===================================================================
-- Descripción: Almacena la información de los usuarios del sistema
-- ===================================================================

DROP TABLE IF EXISTS usuarios;

CREATE TABLE usuarios (
    -- Clave primaria
    id INT AUTO_INCREMENT PRIMARY KEY,
    
    -- Información básica del usuario
    nombre VARCHAR(100) NOT NULL COMMENT 'Nombre completo del usuario',
    email VARCHAR(255) NOT NULL UNIQUE COMMENT 'Email único del usuario',
    telefono VARCHAR(20) NOT NULL COMMENT 'Número de teléfono del usuario',
    password VARCHAR(255) NOT NULL COMMENT 'Contraseña hasheada del usuario',
    
    -- Campos de auditoría
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Fecha y hora de creación',
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Fecha y hora de última actualización',
    
    -- Índices para optimizar consultas
    INDEX idx_email (email),
    INDEX idx_nombre (nombre),
    INDEX idx_fecha_creacion (fecha_creacion)
) 
ENGINE=InnoDB 
DEFAULT CHARSET=utf8mb4 
COLLATE=utf8mb4_unicode_ci
COMMENT='Tabla para almacenar información de usuarios';

-- ===================================================================
-- DATOS DE EJEMPLO (OPCIONAL)
-- ===================================================================
-- Insertar algunos usuarios de ejemplo para pruebas
-- ===================================================================

-- Contraseña para todos los usuarios de ejemplo: "Password123!"
-- Hash generado con bcrypt (12 rounds)
INSERT INTO usuarios (nombre, email, telefono, password) VALUES
('Juan Pérez', 'juan.perez@ejemplo.com', '+52 55 1234-5678', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewmVg7BYMzfpcXSO'),
('María García', 'maria.garcia@ejemplo.com', '+52 55 2345-6789', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewmVg7BYMzfpcXSO'),
('Carlos López', 'carlos.lopez@ejemplo.com', '+52 55 3456-7890', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewmVg7BYMzfpcXSO'),
('Ana Martínez', 'ana.martinez@ejemplo.com', '+52 55 4567-8901', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewmVg7BYMzfpcXSO'),
('Luis Rodríguez', 'luis.rodriguez@ejemplo.com', '+52 55 5678-9012', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewmVg7BYMzfpcXSO'),
('Elena Fernández', 'elena.fernandez@ejemplo.com', '+52 55 6789-0123', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewmVg7BYMzfpcXSO'),
('Miguel Torres', 'miguel.torres@ejemplo.com', '+52 55 7890-1234', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewmVg7BYMzfpcXSO'),
('Patricia Ruiz', 'patricia.ruiz@ejemplo.com', '+52 55 8901-2345', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewmVg7BYMzfpcXSO'),
('Roberto Jiménez', 'roberto.jimenez@ejemplo.com', '+52 55 9012-3456', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewmVg7BYMzfpcXSO'),
('Carmen Morales', 'carmen.morales@ejemplo.com', '+52 55 0123-4567', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewmVg7BYMzfpcXSO');

-- ===================================================================
-- PROCEDIMIENTOS ALMACENADOS (OPCIONAL)
-- ===================================================================

-- Procedimiento para obtener estadísticas de usuarios
DELIMITER $$
CREATE PROCEDURE ObtenerEstadisticasUsuarios()
BEGIN
    SELECT 
        COUNT(*) as total_usuarios,
        COUNT(CASE WHEN fecha_creacion >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END) as usuarios_ultima_semana,
        COUNT(CASE WHEN fecha_creacion >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 END) as usuarios_ultimo_mes,
        MIN(fecha_creacion) as primer_registro,
        MAX(fecha_creacion) as ultimo_registro
    FROM usuarios;
END$$
DELIMITER ;

-- Procedimiento para buscar usuarios por patrón de nombre
DELIMITER $$
CREATE PROCEDURE BuscarUsuariosPorNombre(IN patron VARCHAR(100))
BEGIN
    SELECT * FROM usuarios 
    WHERE nombre LIKE CONCAT('%', patron, '%')
    ORDER BY nombre;
END$$
DELIMITER ;

-- ===================================================================
-- VISTAS (OPCIONAL)
-- ===================================================================

-- Vista para mostrar usuarios con información formateada
CREATE VIEW vista_usuarios AS
SELECT 
    id,
    nombre,
    email,
    telefono,
    DATE_FORMAT(fecha_creacion, '%d/%m/%Y %H:%i') as fecha_creacion_formato,
    DATE_FORMAT(fecha_actualizacion, '%d/%m/%Y %H:%i') as fecha_actualizacion_formato,
    DATEDIFF(NOW(), fecha_creacion) as dias_desde_registro
FROM usuarios
ORDER BY fecha_creacion DESC;

-- ===================================================================
-- TRIGGERS (OPCIONAL)
-- ===================================================================

-- Trigger para validar email antes de insertar
DELIMITER $$
CREATE TRIGGER validar_email_insert
BEFORE INSERT ON usuarios
FOR EACH ROW
BEGIN
    -- Validar formato de email básico
    IF NEW.email NOT REGEXP '^[A-Za-z0-9._%-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,4}$' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Formato de email inválido';
    END IF;
    
    -- Validar que el nombre no esté vacío
    IF TRIM(NEW.nombre) = '' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El nombre no puede estar vacío';
    END IF;
    
    -- Limpiar espacios en blanco
    SET NEW.nombre = TRIM(NEW.nombre);
    SET NEW.email = TRIM(LOWER(NEW.email));
    SET NEW.telefono = TRIM(NEW.telefono);
END$$
DELIMITER ;

-- Trigger para validar email antes de actualizar
DELIMITER $$
CREATE TRIGGER validar_email_update
BEFORE UPDATE ON usuarios
FOR EACH ROW
BEGIN
    -- Validar formato de email básico
    IF NEW.email NOT REGEXP '^[A-Za-z0-9._%-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,4}$' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Formato de email inválido';
    END IF;
    
    -- Validar que el nombre no esté vacío
    IF TRIM(NEW.nombre) = '' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El nombre no puede estar vacío';
    END IF;
    
    -- Limpiar espacios en blanco
    SET NEW.nombre = TRIM(NEW.nombre);
    SET NEW.email = TRIM(LOWER(NEW.email));
    SET NEW.telefono = TRIM(NEW.telefono);
END$$
DELIMITER ;

-- ===================================================================
-- ÍNDICES ADICIONALES PARA OPTIMIZACIÓN
-- ===================================================================

-- Índice compuesto para búsquedas por nombre y email
CREATE INDEX idx_nombre_email ON usuarios(nombre, email);

-- Índice para ordenar por fecha de actualización
CREATE INDEX idx_fecha_actualizacion ON usuarios(fecha_actualizacion);

-- ===================================================================
-- CONSULTAS DE VERIFICACIÓN
-- ===================================================================

-- Verificar que la tabla se creó correctamente
DESCRIBE usuarios;

-- Mostrar los índices creados
SHOW INDEX FROM usuarios;

-- Contar registros insertados
SELECT COUNT(*) as total_usuarios FROM usuarios;

-- Mostrar algunos registros de ejemplo
SELECT * FROM usuarios LIMIT 5;

-- ===================================================================
-- COMANDOS DE MANTENIMIENTO
-- ===================================================================

-- Para optimizar la tabla (ejecutar periódicamente)
-- OPTIMIZE TABLE usuarios;

-- Para analizar la tabla y actualizar estadísticas
-- ANALYZE TABLE usuarios;

-- Para verificar la integridad de la tabla
-- CHECK TABLE usuarios;

-- Para reparar la tabla si hay problemas
-- REPAIR TABLE usuarios;

-- ===================================================================
-- BACKUP Y RESTAURACIÓN
-- ===================================================================

-- Comando para hacer backup (ejecutar desde terminal):
-- mysqldump -u [usuario] -p usuarios_db > backup_usuarios.sql

-- Comando para restaurar (ejecutar desde terminal):
-- mysql -u [usuario] -p usuarios_db < backup_usuarios.sql

-- ===================================================================
-- NOTAS IMPORTANTES
-- ===================================================================

/*
1. CONFIGURACIÓN DE CARACTERES:
   - Se usa utf8mb4 para soporte completo de Unicode
   - Permite emojis y caracteres especiales

2. MOTOR DE ALMACENAMIENTO:
   - InnoDB para soporte de transacciones y claves foráneas
   - Mejor rendimiento para aplicaciones web

3. CAMPOS DE AUDITORÍA:
   - fecha_creacion: Se establece automáticamente al crear
   - fecha_actualizacion: Se actualiza automáticamente al modificar

4. VALIDACIONES:
   - Email único a nivel de base de datos
   - Triggers para validaciones adicionales
   - Límites de longitud para prevenir ataques

5. ÍNDICES:
   - Optimizan las consultas más comunes
   - email: Para búsquedas y validaciones de unicidad
   - nombre: Para búsquedas por nombre
   - fecha_creacion: Para ordenamiento cronológico

6. PROCEDIMIENTOS ALMACENADOS:
   - Opcional, para operaciones complejas
   - Reducen la carga en la aplicación

7. VISTAS:
   - Opcional, para simplificar consultas complejas
   - Útiles para reportes y análisis

8. TRIGGERS:
   - Opcional, para validaciones automáticas
   - Garantizan la integridad de los datos

RECOMENDACIONES DE SEGURIDAD:
- Usar usuario de BD con permisos limitados
- Encriptar conexiones (SSL/TLS)
- Validar datos también en la aplicación
- Realizar backups regulares
- Monitorear logs de acceso

RENDIMIENTO:
- Los índices mejoran las consultas SELECT
- Pueden ralentizar INSERT/UPDATE
- Monitorear y ajustar según uso real
*/

-- ===================================================================
-- FIN DEL SCRIPT
-- ===================================================================

-- Mostrar mensaje de confirmación
SELECT 'Base de datos y tabla de usuarios creada exitosamente!' as mensaje;
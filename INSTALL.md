# 🚀 Instalación Rápida

## Pasos para ejecutar la aplicación:

### 1. Instalar dependencias

```bash
npm install
```

### 2. Configurar MySQL

```sql
-- Conectarse a MySQL como root
mysql -u root -p

-- Crear la base de datos
CREATE DATABASE usuarios_db;

-- Ejecutar el script completo
SOURCE docs/database.sql;
```

### 3. Configurar variables de entorno

Editar el archivo `.env` con tus credenciales de MySQL:

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=tu_password_aqui
DB_NAME=usuarios_db
```

### 4. Ejecutar la aplicación

```bash
# Desarrollo (con auto-reload)
npm run dev

# O en modo producción
npm start
```

### 5. Probar la API

Abre tu navegador en: http://localhost:3000

### 6. Endpoints disponibles:

- `GET /` - Información de la API
- `GET /health` - Estado de la aplicación
- `GET /docs` - Documentación
- `GET /api/v1/users` - Lista de usuarios
- `POST /api/v1/users` - Crear usuario
- `PUT /api/v1/users/:id` - Actualizar usuario
- `DELETE /api/v1/users/:id` - Eliminar usuario

### 7. Ejemplo de creación de usuario:

```bash
curl -X POST http://localhost:3000/api/v1/users \
  -H "Content-Type: application/json" \
  -d '{
    "nombre": "Juan Pérez",
    "email": "juan@ejemplo.com",
    "telefono": "+1234567890"
  }'
```

¡Listo! Tu API REST está funcionando. 🎉

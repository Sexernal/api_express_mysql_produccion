/**
 * app.js — API con integración de módulos médicos y subida de archivos
 */

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Config y middlewares propios
const { testConnection } = require('./config/database');
const { sanitizeInput, validateJSON, validateContentType } = require('./middleware/validation'); // usamos validateContentType actualizado

// Rutas principales (solo require, no deben requerir app)
// Asegúrate que en tus archivos de rutas no haya `require('../app')` (evita dependencia circular)
const userRoutes = require('./routes/userRoutes');
const authRoutes = require('./routes/authRoutes');
const propietariosRoutes = require('./routes/propietariosRoutes');
const mascotasRoutes = require('./routes/mascotasRoutes');
const medicalRoutes = require('./routes/medicalRoutes'); // contiene rutas /medical-records...
const citasRoutes = require('./routes/citasRoutes'); // router de citas
const serviciosRoutes = require('./routes/serviciosRoutes');
const comandaRoutes   = require('./routes/comandaRoutes');
const vacunasRoutes   = require('./routes/vacunasRoutes');
const notificacionesRoutes = require('./routes/notificacionesRoutes');
const reportesRoutes       = require('./routes/reportesRoutes');
const consolidadoRoutes    = require('./routes/consolidadoRoutes');

// Crear app y constantes (DEBEN ir antes de usar app.use)
const app = express();
const PORT = process.env.PORT || 3000;
const API_PREFIX = process.env.API_PREFIX || '/api/v1';

// --- Preparar carpeta uploads (y subcarpeta medical) ---
const uploadsRoot = path.join(__dirname, 'uploads');
const medicalUploads = path.join(uploadsRoot, 'medical');

try {
  fs.mkdirSync(medicalUploads, { recursive: true });
  try { fs.chmodSync(medicalUploads, 0o775); } catch(e){}
  console.log('📁 Carpeta uploads ok:', medicalUploads);
} catch (err) {
  console.warn('⚠️ No se pudo crear carpeta uploads:', err.message || err);
}

// servir archivos estáticos de uploads
app.use('/uploads', express.static(uploadsRoot));

// --- Middlewares ---
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Validamos content type (acepta application/json y multipart/form-data)
app.use(validateContentType);

// sanitizar y validar JSON (no bloquea multipart)
app.use(sanitizeInput);
app.use(validateJSON);

// CORS
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://tu-dominio.com']
    : ['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000'],
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','PATCH','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));

// logging en dev
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });
}

/* ---------------- Rutas ---------------- */

// health
app.get('/', (req, res) => {
  res.json({ success: true, message: 'API funcionando', version: '1.0.0', timestamp: new Date().toISOString() });
});

app.get('/health', async (req, res) => {
  try {
    const dbConnected = await testConnection();
    res.json({ success: true, status: 'healthy', services: { database: dbConnected ? 'connected' : 'disconnected' } });
  } catch (err) {
    res.status(503).json({ success: false, status: 'unhealthy', error: err.message });
  }
});

// API routes
app.use(`${API_PREFIX}/users`, userRoutes);
app.use(`${API_PREFIX}/auth`, authRoutes);
app.use(`${API_PREFIX}/propietarios`, propietariosRoutes);
app.use(`${API_PREFIX}/mascotas`, mascotasRoutes);

// Montamos rutas médicas en la raíz del prefijo API para que coincida con frontend:
// => frontend usa /medical-records (sin /medical). Quedará: /api/v1/medical-records
app.use(`${API_PREFIX}`, medicalRoutes);

// Rutas de citas
app.use(`${API_PREFIX}/citas`, citasRoutes);

app.use(`${API_PREFIX}/servicios`, serviciosRoutes);
app.use(`${API_PREFIX}`,           comandaRoutes);
app.use(`${API_PREFIX}`,           vacunasRoutes);
app.use(`${API_PREFIX}`,           notificacionesRoutes);
app.use(`${API_PREFIX}`,           reportesRoutes);
app.use(`${API_PREFIX}`,           consolidadoRoutes);

// docs (breve)
app.get('/docs', (req, res) => {
  res.json({
    success: true,
    baseUrl: `${req.protocol}://${req.get('host')}${API_PREFIX}`,
    endpointsSummary: {
      users: `${API_PREFIX}/users`,
      auth: `${API_PREFIX}/auth`,
      propietarios: `${API_PREFIX}/propietarios`,
      mascotas: `${API_PREFIX}/mascotas`,
      medical: `${API_PREFIX}/medical-records`,
      citas: `${API_PREFIX}/citas`
    }
  });
});

/* ---------- Manejo errores / 404 ---------- */

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Ruta no encontrada', requestedUrl: req.originalUrl });
});

app.use((err, req, res, next) => {
  console.error('Error global:', err);
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'JSON malformado' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ success: false, message: 'Payload demasiado grande' });
  }
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Error interno servidor' : err.message,
    timestamp: new Date().toISOString()
  });
});

/* ---------- Inicialización ---------- */

const initializeApp = async () => {
  try {
    console.log('🔍 Verificando conexión a base de datos...');
    await testConnection();
    const server = app.listen(PORT, () => {
      console.log(`🚀 Servidor escuchando en http://localhost:${PORT}`);
      console.log(`📋 API base: http://localhost:${PORT}${API_PREFIX}`);
    });

    // Tarea programada de recordatorios por email (Canal A)
    try {
      require('./jobs/recordatoriosJob').start();
    } catch (err) {
      console.warn('⚠️ No se pudo iniciar el job de recordatorios:', err.message || err);
    }

    process.on('SIGTERM', () => server.close(() => process.exit(0)));
    process.on('SIGINT', () => server.close(() => process.exit(0)));
  } catch (err) {
    console.error('❌ Error inicializando app:', err.message || err);
    process.exit(1);
  }
};

if (require.main === module) initializeApp();

module.exports = app;

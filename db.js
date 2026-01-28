// db.js
const dbModule = require('./config/database');

const pool = dbModule.pool;

// Exponer una interfaz cómoda usada en los controladores:
// - db.query(...)   (usa pool.query)
// - db.getConnection()
// - db.testConnection()
// - db.closePool()
// - db.pool (por si alguien necesita el pool directamente)
module.exports = {
  query: (...args) => pool.query(...args),
  getConnection: dbModule.getConnection,
  testConnection: dbModule.testConnection,
  closePool: dbModule.closePool,
  pool
};
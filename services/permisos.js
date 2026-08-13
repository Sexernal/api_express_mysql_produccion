// services/permisos.js
//
// Única fuente de verdad de quién puede hacer qué en el API.
//
// La regla es: los permisos se definen AQUÍ y en ningún otro lado. Si mañana
// hay que abrirle algo a recepción, se cambia una línea de esta tabla y queda
// aplicado en todas las rutas que lo usan.
//
// ⚠️ El frontend tiene una copia de esta misma tabla en components/permisos.js
// para decidir qué botones dibuja. Si cambias algo aquí, cámbialo allá también.
// Ojo: el frontend solo ESCONDE botones; quien manda de verdad es este archivo,
// porque un botón oculto no impide que alguien llame la ruta a mano.

// ─── Roles ───────────────────────────────────────────────────────────
const ROLES = {
  SUPERADMIN:  'superadmin',   // Administración de la veterinaria (Norival)
  VETERINARIO: 'admin',        // Doctores. 'admin' por compatibilidad histórica
  RECEPCION:   'user',         // Recepcionistas
  PROPIETARIO: 'propietario',  // Clientes, desde la app móvil
};

// Etiqueta visible. 'admin' dice "Doctor(a)" porque en este sistema ese rol
// identifica al veterinario, no a un administrador.
const ETIQUETAS = {
  superadmin:  'Administrador',
  admin:       'Doctor(a)',
  user:        'Recepcionista',
  propietario: 'Propietario',
};

// ─── Matriz de permisos ──────────────────────────────────────────────
// Cada permiso lista los roles que lo tienen. Lo que no está listado,
// está prohibido.
const PERMISOS = {
  // ── Administrativo: exclusivo del super admin ──
  'usuarios.gestionar':     ['superadmin'],                 // dar de alta y editar personal
  'servicios.gestionar':    ['superadmin'],                 // catálogo de precios de las comandas
  'reportes.ver':           ['superadmin'],                 // estadísticas del negocio

  // ── Clínico: super admin y veterinarios ──
  'consolidado.ver':        ['superadmin', 'admin'],        // informe para el Colegio de Veterinarios
  'propietarios.gestionar': ['superadmin', 'admin'],
  'mascotas.gestionar':     ['superadmin', 'admin'],
  'fichas.gestionar':       ['superadmin', 'admin'],        // fichas médicas y tratamientos
  'vacunas.gestionar':      ['superadmin', 'admin'],
  'comandas.editar':        ['superadmin', 'admin'],        // llenar la comanda durante la consulta

  // ── Operación diaria: todo el personal ──
  'citas.gestionar':        ['superadmin', 'admin', 'user'],
  'facturacion.ver':        ['superadmin', 'admin', 'user'],
  'facturacion.cobrar':     ['superadmin', 'admin', 'user'],
  'notificaciones.ver':     ['superadmin', 'admin', 'user'],
};

// ─── Consultas ───────────────────────────────────────────────────────

function normalizar(role) {
  return String(role || '').trim().toLowerCase();
}

// ¿Este rol tiene este permiso?
function puede(role, permiso) {
  const lista = PERMISOS[permiso];
  if (!lista) {
    // Un permiso mal escrito no debe abrir la puerta por accidente
    console.error(`⚠️ permisos: "${permiso}" no está definido en la matriz`);
    return false;
  }
  return lista.includes(normalizar(role));
}

// Personal de la clínica que atiende pacientes. Es el reemplazo de los
// `role !== 'admin'` sueltos que había por el código y que dejaban fuera
// al super admin.
function esPersonalClinico(role) {
  const r = normalizar(role);
  return r === ROLES.SUPERADMIN || r === ROLES.VETERINARIO;
}

// Cualquiera que trabaje en la clínica (excluye propietarios)
function esPersonal(role) {
  const r = normalizar(role);
  return r === ROLES.SUPERADMIN || r === ROLES.VETERINARIO || r === ROLES.RECEPCION;
}

const etiquetaRol = (role) => ETIQUETAS[normalizar(role)] || 'Usuario';

// Todos los permisos de un rol. El login lo devuelve para que el frontend
// sepa qué dibujar sin tener que adivinar a partir del nombre del rol.
function permisosDe(role) {
  const r = normalizar(role);
  return Object.keys(PERMISOS).filter(p => PERMISOS[p].includes(r));
}

module.exports = {
  ROLES,
  ETIQUETAS,
  PERMISOS,
  puede,
  esPersonalClinico,
  esPersonal,
  etiquetaRol,
  permisosDe,
};

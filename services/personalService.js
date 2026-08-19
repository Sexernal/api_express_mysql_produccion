// services/personalService.js
//
// Reglas de gestión del personal, sobre todo el cambio de rol.
//
// Ascender a alguien a Administrador es la acción más delicada del sistema:
// le abre reportes, el catálogo de precios y la gestión del propio personal.
// Las salvaguardas viven aquí, no en el controlador, para que sean una sola
// verdad y se puedan probar por separado.
const bcrypt = require('bcryptjs');
const db     = require('../db');
const { ROLES, etiquetaRol } = require('./permisos');

// Roles que se pueden asignar desde la interfaz. 'propietario' no está:
// esos viven en otra tabla y no son personal de la clínica.
const ROLES_ASIGNABLES = [ROLES.SUPERADMIN, ROLES.VETERINARIO, ROLES.RECEPCION];

const SELECT_PERSONAL = `
  SELECT id, cedula, nombre, email, telefono, role, especialidad, direccion,
         fecha_creacion AS created_at
  FROM usuarios
`;

// Igual que en passwordResetService: User.create rellena el correo con
// `${cedula}@pendiente.vet` cuando solo se da la cédula. Ese dominio no
// existe, así que la pantalla debe poder avisarlo.
const DOMINIOS_DE_RELLENO = ['@pendiente.vet'];

function correoUtilizable(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e || !e.includes('@')) return false;
  return !DOMINIOS_DE_RELLENO.some(d => e.endsWith(d));
}

function mapPersona(u) {
  return {
    ...u,
    role_label:       etiquetaRol(u.role),
    // La pantalla lo usa para marcar a quién hay que arreglarle el correo:
    // sin correo real no puede restablecer su contraseña.
    correo_utilizable: correoUtilizable(u.email),
  };
}

async function listar() {
  // Administradores primero, después doctores, después recepción
  const [rows] = await db.query(
    `${SELECT_PERSONAL}
     ORDER BY FIELD(role, 'superadmin', 'admin', 'user'), nombre ASC`
  );
  return rows.map(mapPersona);
}

async function buscarPorId(id) {
  const [rows] = await db.query(`${SELECT_PERSONAL} WHERE id = ?`, [id]);
  return rows.length ? mapPersona(rows[0]) : null;
}

async function contarSuperadmins(conn = db) {
  const [[{ total }]] = await conn.query(
    "SELECT COUNT(*) AS total FROM usuarios WHERE role = 'superadmin'"
  );
  return Number(total);
}

// Confirma que quien está al teclado es de verdad el administrador y no
// alguien que encontró su sesión abierta.
async function verificarPasswordDe(actorId, password) {
  if (!password) return 'Debes confirmar con tu contraseña';
  const [rows] = await db.query('SELECT password FROM usuarios WHERE id = ?', [actorId]);
  if (!rows.length) return 'No se pudo verificar tu identidad';
  const ok = await bcrypt.compare(String(password), rows[0].password);
  return ok ? null : 'La contraseña no es correcta';
}

// ─── Reglas del cambio de rol ────────────────────────────────────────
// Devuelve un mensaje de error, o null si el cambio se puede hacer.
//
// Se comprueban ANTES de pedir la contraseña para no hacer escribirla
// en vano, y otra vez del lado del servidor antes de aplicar.
async function validarCambioDeRol({ actorId, objetivo, rolNuevo }) {
  if (!ROLES_ASIGNABLES.includes(rolNuevo)) {
    return `Rol inválido. Debe ser uno de: ${ROLES_ASIGNABLES.join(', ')}`;
  }
  if (!objetivo) return 'El usuario no existe';

  // Nadie cambia su propio rol. Corta de raíz el auto-ascenso y, de paso,
  // que alguien se degrade solo y pierda el acceso sin querer.
  if (Number(actorId) === Number(objetivo.id)) {
    return 'No puedes cambiar tu propio rol. Pídeselo a otro administrador.';
  }

  if (objetivo.role === rolNuevo) {
    return `Esa persona ya es ${etiquetaRol(rolNuevo)}`;
  }

  // La clínica no puede quedarse sin nadie que administre el sistema:
  // sin superadmins nadie podría volver a ascender a nadie.
  if (objetivo.role === ROLES.SUPERADMIN && rolNuevo !== ROLES.SUPERADMIN) {
    const cuantos = await contarSuperadmins();
    if (cuantos <= 1) {
      return 'No puedes quitar el último administrador del sistema. Asciende a otra persona primero.';
    }
  }

  return null;
}

// ─── Auditoría ───────────────────────────────────────────────────────
// Que falle el registro no debe deshacer un cambio ya aplicado, pero sí
// debe quedar en el log del servidor.
async function registrar({ usuarioId, actorId, actorNombre, accion, anterior, nuevo, ip }, conn = db) {
  try {
    await conn.query(
      `INSERT INTO usuarios_log
         (usuario_id, actor_id, actor_nombre, accion, valor_anterior, valor_nuevo, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [usuarioId, actorId ?? null, actorNombre ?? null, accion, anterior ?? null, nuevo ?? null, ip ?? null]
    );
  } catch (err) {
    console.error('⚠️ No se pudo registrar en usuarios_log:', err.message);
  }
}

async function historialDe(usuarioId, limite = 50) {
  const [rows] = await db.query(
    `SELECT id, accion, valor_anterior, valor_nuevo, actor_nombre, created_at
     FROM usuarios_log
     WHERE usuario_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
    [usuarioId, limite]
  );
  return rows;
}

// Correos de los demás administradores, para avisarles de un ascenso.
// Se excluye a quien hizo el cambio: ya sabe lo que hizo.
async function correosDeAdmins(exceptoId = null) {
  const [rows] = await db.query(
    `SELECT nombre, email FROM usuarios
     WHERE role = 'superadmin' AND id <> ? AND email IS NOT NULL`,
    [exceptoId ?? 0]
  );
  return rows.filter(r => correoUtilizable(r.email));
}

module.exports = {
  ROLES_ASIGNABLES,
  correoUtilizable,
  listar,
  buscarPorId,
  contarSuperadmins,
  verificarPasswordDe,
  validarCambioDeRol,
  registrar,
  historialDe,
  correosDeAdmins,
};

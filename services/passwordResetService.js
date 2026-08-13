// services/passwordResetService.js
//
// Restablecimiento de contraseña para los dos logins del sistema.
// Vive aquí y no en un controlador porque lo usan dos: authController
// (doctores, desde la web) y propietariosController (clientes, desde la app).
//
// Las contraseñas van con bcrypt, que es de una sola vía: no se pueden leer
// ni devolver. Lo que se emite es un permiso temporal para escribir una nueva.
const crypto = require('crypto');
const db     = require('../db');

// ─── Parámetros ──────────────────────────────────────────────────────
const MINUTOS_VIGENCIA   = 30;
const MAX_INTENTOS       = 5;   // códigos errados antes de anular el permiso
const MAX_SOLICITUDES_H  = 5;   // por cuenta y por hora
const PASSWORD_MIN       = 8;

const TIPOS = {
  usuario:     { tabla: 'usuarios',     etiqueta: 'usuario'     },
  propietario: { tabla: 'propietarios', etiqueta: 'propietario' },
};

// ─── Utilidades ──────────────────────────────────────────────────────

// Solo se guarda el hash. Si la base se filtra, lo almacenado no sirve
// para entrar: haría falta el token original, que solo viaja al correo.
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

// Token largo para el enlace web: 32 bytes = 256 bits, imposible de adivinar.
const generarToken = () => crypto.randomBytes(32).toString('hex');

// Código corto para la app. Tiene poca entropía a propósito (hay que poder
// teclearlo), y por eso depende del límite de intentos y de la expiración.
// randomInt es criptográficamente seguro; Math.random NO lo es.
const generarCodigo = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

// "juan.perez@gmail.com" → "ju••••••@gmail.com"
// Da la pista justa para saber a qué bandeja ir sin exponer el correo.
function enmascararEmail(email) {
  const s = String(email || '');
  const i = s.lastIndexOf('@');
  if (i < 1) return '•••';
  const usuario = s.slice(0, i);
  const dominio = s.slice(i);
  const visible = usuario.slice(0, Math.min(2, usuario.length));
  return `${visible}${'•'.repeat(Math.max(3, usuario.length - visible.length))}${dominio}`;
}

// User.create rellena el correo con `${cedula}@pendiente.vet` cuando se da de
// alta a alguien solo con la cédula (el modal "Nuevo personal" no lo pide).
// Ese dominio no existe: si lo tratáramos como correo válido, el sistema diría
// "enviamos las instrucciones" y el mensaje no llegaría a ninguna parte.
const DOMINIOS_DE_RELLENO = ['@pendiente.vet'];

function correoUtilizable(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e || !e.includes('@')) return false;
  return !DOMINIOS_DE_RELLENO.some(d => e.endsWith(d));
}

function validarPassword(password) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN)
    return `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres`;
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password))
    return 'La contraseña debe combinar letras y números';
  return null;
}

// ─── Búsqueda de la cuenta ───────────────────────────────────────────
// Ambos logins usan cédula, así que la recuperación también.
async function buscarPorCedula(tipo, cedula) {
  const cfg = TIPOS[tipo];
  if (!cfg) throw new Error(`Tipo de cuenta inválido: ${tipo}`);

  const [rows] = await db.query(
    `SELECT id, nombre, email FROM ${cfg.tabla} WHERE cedula = ? LIMIT 1`,
    [String(cedula).trim()]
  );
  return rows[0] || null;
}

// ─── Emisión ─────────────────────────────────────────────────────────

// Cuántas solicitudes lleva esta cuenta en la última hora.
// Frena a quien intente inundar de correos la bandeja de otra persona.
async function solicitudesRecientes(tipo, referenciaId) {
  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM password_resets
     WHERE tipo = ? AND referencia_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)`,
    [tipo, referenciaId]
  );
  return Number(total);
}

// Al pedir uno nuevo, los anteriores dejan de servir: si alguien intercepta
// un correo viejo, ese permiso ya está muerto.
async function invalidarAnteriores(tipo, referenciaId, conn = db) {
  await conn.query(
    `UPDATE password_resets SET usado_en = NOW()
     WHERE tipo = ? AND referencia_id = ? AND usado_en IS NULL`,
    [tipo, referenciaId]
  );
}

// Emite un permiso. Devuelve { token } en claro UNA sola vez: es lo único
// que se manda por correo, y no vuelve a existir en ningún lado.
//
// formato: 'token' (enlace web, 64 hex) | 'codigo' (app, 6 dígitos)
async function emitir({ tipo, referenciaId, formato = 'token', ip = null }) {
  const usados = await solicitudesRecientes(tipo, referenciaId);
  if (usados >= MAX_SOLICITUDES_H) {
    return { error: 'Demasiadas solicitudes. Espera una hora antes de volver a intentarlo.' };
  }

  const token = formato === 'codigo' ? generarCodigo() : generarToken();

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await invalidarAnteriores(tipo, referenciaId, conn);
    await conn.query(
      `INSERT INTO password_resets (tipo, referencia_id, token_hash, expira_en, ip)
       VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), ?)`,
      [tipo, referenciaId, hashToken(token), MINUTOS_VIGENCIA, ip]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }

  return { token, minutos: MINUTOS_VIGENCIA };
}

// ─── Consumo ─────────────────────────────────────────────────────────

// Mensaje único para token inexistente, vencido o ya usado: distinguirlos
// solo le sirve a quien esté probando tokens al azar.
const MSG_INVALIDO = 'El enlace no es válido o ya venció. Solicita uno nuevo.';

// Verifica sin consumir. La usa la web para saber si vale la pena mostrar
// el formulario antes de que la persona escriba la contraseña.
async function verificar({ tipo, token }) {
  const [rows] = await db.query(
    `SELECT id, referencia_id, expira_en, usado_en, intentos
     FROM password_resets
     WHERE tipo = ? AND token_hash = ? LIMIT 1`,
    [tipo, hashToken(token)]
  );
  const permiso = rows[0];
  if (!permiso)                                  return { error: MSG_INVALIDO };
  if (permiso.usado_en)                          return { error: MSG_INVALIDO };
  if (new Date(permiso.expira_en) < new Date())  return { error: MSG_INVALIDO };
  if (permiso.intentos >= MAX_INTENTOS)          return { error: MSG_INVALIDO };
  return { permiso };
}

// Consume el permiso. `referenciaEsperada` ata el código a la cédula que se
// escribió: sin eso, un código de 6 dígitos serviría para cualquier cuenta.
async function consumir({ tipo, token, referenciaEsperada = null }) {
  const [rows] = await db.query(
    `SELECT id, referencia_id, expira_en, usado_en, intentos
     FROM password_resets
     WHERE tipo = ? AND token_hash = ? LIMIT 1`,
    [tipo, hashToken(token)]
  );
  const permiso = rows[0];

  // Token que no existe: si venía con cédula, contamos el fallo contra el
  // permiso vigente de esa cuenta para que 6 dígitos no se puedan barrer.
  if (!permiso) {
    if (referenciaEsperada) await registrarFallo(tipo, referenciaEsperada);
    return { error: MSG_INVALIDO };
  }
  if (permiso.usado_en)                         return { error: MSG_INVALIDO };
  if (new Date(permiso.expira_en) < new Date()) return { error: MSG_INVALIDO };
  if (permiso.intentos >= MAX_INTENTOS)         return { error: MSG_INVALIDO };

  if (referenciaEsperada && Number(permiso.referencia_id) !== Number(referenciaEsperada)) {
    await registrarFallo(tipo, referenciaEsperada);
    return { error: MSG_INVALIDO };
  }

  // Sellarlo condicionando a que siga sin usar: si llegan dos peticiones a la
  // vez, solo una consigue affectedRows = 1 y la otra queda fuera.
  const [res] = await db.query(
    'UPDATE password_resets SET usado_en = NOW() WHERE id = ? AND usado_en IS NULL',
    [permiso.id]
  );
  if (res.affectedRows !== 1) return { error: MSG_INVALIDO };

  return { referenciaId: Number(permiso.referencia_id) };
}

async function registrarFallo(tipo, referenciaId) {
  await db.query(
    `UPDATE password_resets SET intentos = intentos + 1
     WHERE tipo = ? AND referencia_id = ? AND usado_en IS NULL`,
    [tipo, referenciaId]
  );
}

module.exports = {
  MINUTOS_VIGENCIA,
  MAX_INTENTOS,
  PASSWORD_MIN,
  enmascararEmail,
  correoUtilizable,
  validarPassword,
  buscarPorCedula,
  emitir,
  verificar,
  consumir,
};

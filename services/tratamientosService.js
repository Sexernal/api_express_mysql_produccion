// services/tratamientosService.js
//
// Lógica compartida de tratamientos. Vive aquí y no dentro de un
// controlador porque la usan dos: tratamientosController (CRUD directo)
// y medicalController (al crear/editar una ficha con seguimiento).
const db = require('../db');

const ESTADOS = ['activo', 'finalizado'];

const TIPO_LABELS = {
  consulta:        'Consulta general',
  vacunacion:      'Vacunación',
  cirugia:         'Cirugía',
  urgencia:        'Urgencia',
  control:         'Control / revisión',
  desparasitacion: 'Desparasitación',
  otro:            'Otro',
};

const NOMBRE_MAX = 160;

// ─── Utilidades de fecha ─────────────────────────────────────────────
function toYMD(val) {
  if (!val) return null;
  if (val instanceof Date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${val.getFullYear()}-${pad(val.getMonth() + 1)}-${pad(val.getDate())}`;
  }
  const m = String(val).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function displayYMD(ymd) {
  if (!ymd) return null;
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

function isValidYMD(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime());
}

function diasEntre(desdeYMD, hastaYMD) {
  if (!desdeYMD || !hastaYMD) return null;
  const [y1, m1, d1] = desdeYMD.split('-').map(Number);
  const [y2, m2, d2] = hastaYMD.split('-').map(Number);
  return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000);
}

// ─── Nombre automático ───────────────────────────────────────────────
function tipoLabel(ficha) {
  if (ficha.tipo === 'otro' && ficha.tipo_personalizado) return ficha.tipo_personalizado;
  return TIPO_LABELS[ficha.tipo] || ficha.tipo || 'Consulta';
}

// Cuando el tratamiento nace de un "es seguimiento de…", tomamos el
// nombre de la ficha que lo originó. El veterinario puede renombrarlo.
function nombreSugerido(fichaOrigen) {
  const fecha = displayYMD(toYMD(fichaOrigen.fecha));
  const base  = fecha ? `${tipoLabel(fichaOrigen)} — ${fecha}` : tipoLabel(fichaOrigen);
  return base.slice(0, NOMBRE_MAX);
}

// ─── Consulta base ───────────────────────────────────────────────────
// Subconsultas en vez de GROUP BY para no chocar con ONLY_FULL_GROUP_BY.
// El índice idx_fichas_tratamiento las mantiene baratas.
const SELECT_TRATAMIENTO = `
  SELECT t.*,
         u.nombre AS creado_por_nombre,
         m.nombre AS mascota_nombre,
         (SELECT COUNT(*)      FROM fichas_medicas f WHERE f.tratamiento_id = t.id) AS total_fichas,
         (SELECT MIN(f.fecha)  FROM fichas_medicas f WHERE f.tratamiento_id = t.id) AS primera_ficha,
         (SELECT MAX(f.fecha)  FROM fichas_medicas f WHERE f.tratamiento_id = t.id) AS ultima_ficha
  FROM tratamientos t
  LEFT JOIN usuarios u ON t.creado_por = u.id
  LEFT JOIN mascotas m ON t.mascota_id = m.id
`;

function mapTratamiento(r) {
  const inicio  = toYMD(r.fecha_inicio);
  const fin     = toYMD(r.fecha_fin);
  const primera = toYMD(r.primera_ficha);
  const ultima  = toYMD(r.ultima_ficha);
  const cierre  = fin || ultima;

  return {
    ...r,
    total_fichas:  Number(r.total_fichas) || 0,
    fecha_inicio:  inicio,
    fecha_fin:     fin,
    primera_ficha: primera,
    ultima_ficha:  ultima,
    fecha_inicio_display:  displayYMD(inicio)  || '—',
    fecha_fin_display:     displayYMD(fin)     || '—',
    primera_ficha_display: displayYMD(primera) || '—',
    ultima_ficha_display:  displayYMD(ultima)  || '—',
    // Duración real cubierta por las fichas del tratamiento
    duracion_dias: diasEntre(primera || inicio, cierre),
  };
}

// ─── Resolución del grupo ────────────────────────────────────────────
// El corazón del módulo. Devuelve { tratamientoId } o { error }.
//
// Tres caminos:
//   1. tratamientoId  → la ficha se une a un tratamiento que ya existe.
//   2. seguimientoDe  → la ficha es seguimiento de otra ficha:
//        · si esa ficha ya está en un tratamiento, nos unimos a él;
//        · si no, creamos el tratamiento y absorbemos a las dos.
//        Así el grupo nace en la 2ª consulta, que es cuando el
//        veterinario recién sabe que hubo seguimiento.
//   3. ninguno        → ficha suelta (tratamiento_id = NULL).
//
// `conn` permite ejecutarlo dentro de una transacción.
async function resolverTratamiento(
  { mascotaId, tratamientoId, seguimientoDe, userId = null, excluirFichaId = null },
  conn = db
) {
  // 1. Tratamiento explícito
  if (tratamientoId) {
    const [rows] = await conn.query(
      'SELECT id, mascota_id FROM tratamientos WHERE id = ?', [tratamientoId]
    );
    if (!rows.length) return { error: 'El tratamiento indicado no existe' };
    if (Number(rows[0].mascota_id) !== Number(mascotaId))
      return { error: 'El tratamiento no pertenece a esta mascota' };
    return { tratamientoId: Number(tratamientoId) };
  }

  // 2. Seguimiento de una ficha previa
  if (seguimientoDe) {
    if (excluirFichaId && Number(seguimientoDe) === Number(excluirFichaId))
      return { error: 'Una ficha no puede ser seguimiento de sí misma' };

    const [rows] = await conn.query(
      'SELECT id, mascota_id, tratamiento_id, tipo, tipo_personalizado, fecha FROM fichas_medicas WHERE id = ?',
      [seguimientoDe]
    );
    if (!rows.length) return { error: 'La ficha de origen no existe' };

    const origen = rows[0];
    if (Number(origen.mascota_id) !== Number(mascotaId))
      return { error: 'La ficha de origen pertenece a otra mascota' };

    // Ya forma parte de un tratamiento → nos unimos a ese
    if (origen.tratamiento_id) return { tratamientoId: Number(origen.tratamiento_id) };

    // No tiene → lo creamos y absorbemos la ficha de origen
    const [result] = await conn.query(
      `INSERT INTO tratamientos (mascota_id, nombre, fecha_inicio, creado_por)
       VALUES (?, ?, ?, ?)`,
      [mascotaId, nombreSugerido(origen), toYMD(origen.fecha), userId]
    );
    await conn.query(
      'UPDATE fichas_medicas SET tratamiento_id = ? WHERE id = ?',
      [result.insertId, origen.id]
    );
    return { tratamientoId: result.insertId, creado: true };
  }

  // 3. Ficha suelta
  return { tratamientoId: null };
}

// Reajusta fecha_inicio al primer día realmente cubierto por sus fichas.
// Se llama después de agregar, mover o quitar una ficha del tratamiento.
async function sincronizarFechaInicio(tratamientoId, conn = db) {
  if (!tratamientoId) return;
  await conn.query(
    `UPDATE tratamientos t
     SET t.fecha_inicio = COALESCE(
           (SELECT DATE(MIN(f.fecha)) FROM fichas_medicas f WHERE f.tratamiento_id = t.id),
           t.fecha_inicio)
     WHERE t.id = ?`,
    [tratamientoId]
  );
  // Un tratamiento ya finalizado al que se le mueve la fecha de inicio podria
  // quedar con inicio > fin. Esa combinacion la rechaza la validacion del PUT,
  // asi que el tratamiento se volveria imposible de editar: lo corregimos aqui.
  await conn.query(
    `UPDATE tratamientos
     SET fecha_fin = fecha_inicio
     WHERE id = ? AND fecha_fin IS NOT NULL AND fecha_fin < fecha_inicio`,
    [tratamientoId]
  );
}

// Un tratamiento sin fichas no le sirve a nadie: se limpia solo.
// Evita que queden grupos fantasma al desagrupar la última ficha.
async function eliminarSiQuedaVacio(tratamientoId, conn = db) {
  if (!tratamientoId) return false;
  const [[{ total }]] = await conn.query(
    'SELECT COUNT(*) AS total FROM fichas_medicas WHERE tratamiento_id = ?', [tratamientoId]
  );
  if (Number(total) > 0) return false;
  await conn.query('DELETE FROM tratamientos WHERE id = ?', [tratamientoId]);
  return true;
}

module.exports = {
  ESTADOS,
  NOMBRE_MAX,
  SELECT_TRATAMIENTO,
  toYMD,
  displayYMD,
  isValidYMD,
  nombreSugerido,
  mapTratamiento,
  resolverTratamiento,
  sincronizarFechaInicio,
  eliminarSiQuedaVacio,
};

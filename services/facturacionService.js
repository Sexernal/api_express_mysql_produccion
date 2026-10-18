// services/facturacionService.js
//
// Datos de facturación. Vive aquí y no en el controlador porque lo usan tres
// salidas: la pantalla, el PDF de la lista y el PDF del ticket individual.
// Con una sola función no hay forma de que muestren cosas distintas.
const db = require('../db');

// Tope del PDF: evita que un rango de fechas enorme intente armar un documento
// de miles de paginas. Si se alcanza, el controlador lo avisa en el documento.
const TOPE_PDF = 2000;

// Mismo armado de filtros que usa la pantalla. Devuelve el FROM...WHERE
// completo mas los parametros, para reutilizarlo en el COUNT y en el SELECT.
function construirFiltro({ q, cobrado, fecha_desde, fecha_hasta } = {}) {
  const conds  = ['ci.cnt > 0'];
  const params = [];

  if (q) {
    conds.push('(p.nombre LIKE ? OR m.nombre LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (cobrado === '1') conds.push('COALESCE(fc.cobrado, 0) = 1');
  if (cobrado === '0') conds.push('COALESCE(fc.cobrado, 0) = 0');
  if (fecha_desde) { conds.push('DATE(f.fecha) >= ?'); params.push(fecha_desde); }
  if (fecha_hasta) { conds.push('DATE(f.fecha) <= ?'); params.push(fecha_hasta); }

  const base = `
    FROM fichas_medicas f
    JOIN mascotas m ON f.mascota_id = m.id
    LEFT JOIN propietarios p ON p.id = m.owner_id
    LEFT JOIN fichas_cobro fc ON f.id = fc.ficha_id
    LEFT JOIN usuarios u ON f.uploaded_by = u.id
    JOIN (
      SELECT ficha_id,
             COUNT(*) AS cnt,
             SUM(cantidad * precio_unitario) AS total
      FROM comanda_items GROUP BY ficha_id
    ) ci ON ci.ficha_id = f.id
    WHERE ${conds.join(' AND ')}
  `;

  return { base, params };
}

// Carga los items de varias fichas de una sola consulta (evita N+1)
async function itemsDe(fichaIds) {
  if (!fichaIds.length) return {};
  const [items] = await db.query(
    `SELECT * FROM comanda_items
     WHERE ficha_id IN (${fichaIds.map(() => '?').join(',')})
     ORDER BY ficha_id, id`,
    fichaIds
  );
  const porFicha = {};
  for (const it of items) {
    if (!porFicha[it.ficha_id]) porFicha[it.ficha_id] = [];
    porFicha[it.ficha_id].push(it);
  }
  return porFicha;
}

/**
 * Lista de comandas segun los filtros.
 * @param {object} filtros  q, cobrado, fecha_desde, fecha_hasta, page, limit
 * @param {object} opciones todos:true ignora la paginacion (para el PDF)
 */
async function construirFacturacion(filtros = {}, { todos = false } = {}) {
  const { page = 1, limit = 100 } = filtros;
  const { base, params } = construirFiltro(filtros);

  const [[{ total: totalRecs }]] = await db.query(`SELECT COUNT(*) AS total ${base}`, params);

  // El PDF trae TODO lo que cumple el filtro, no solo la pagina en pantalla:
  // un informe paginado a la mitad no sirve para cuadrar caja.
  const tope   = todos ? TOPE_PDF : Number(limit);
  const offset = todos ? 0 : (Number(page) - 1) * Number(limit);

  const [rows] = await db.query(
    `SELECT
       f.id, f.tipo, f.tipo_personalizado, f.fecha, f.nota,
       m.nombre AS mascota_nombre, m.especie,
       p.id    AS propietario_id,
       p.nombre   AS propietario_nombre,
       p.telefono AS propietario_telefono,
       u.nombre   AS veterinario_nombre,
       COALESCE(fc.cobrado, 0) AS cobrado,
       fc.cobrado_at, fc.notas AS notas_cobro,
       ci.total AS total_comanda,
       ci.cnt   AS items_count
     ${base}
     ORDER BY f.fecha DESC
     LIMIT ? OFFSET ?`,
    [...params, tope, offset]
  );

  const porFicha = await itemsDe(rows.map(r => r.id));
  const datos = rows.map(r => ({ ...r, items: porFicha[r.id] || [] }));

  return {
    datos,
    meta: {
      total: totalRecs,
      page: Number(page),
      limit: Number(limit),
      // El PDF lo usa para avisar si quedo contenido fuera por el tope
      truncado: todos && totalRecs > TOPE_PDF,
      tope: TOPE_PDF,
    },
  };
}

// Una sola comanda con sus items, para el ticket individual
async function comandaDeFicha(fichaId) {
  const [rows] = await db.query(
    `SELECT f.id, f.tipo, f.tipo_personalizado, f.fecha, f.nota,
            m.nombre AS mascota_nombre, m.especie, m.raza,
            p.nombre   AS propietario_nombre,
            p.cedula   AS propietario_cedula,
            p.telefono AS propietario_telefono,
            u.nombre   AS veterinario_nombre,
            COALESCE(fc.cobrado, 0) AS cobrado,
            fc.cobrado_at, fc.notas AS notas_cobro
     FROM fichas_medicas f
     JOIN mascotas m ON f.mascota_id = m.id
     LEFT JOIN propietarios p ON p.id = m.owner_id
     LEFT JOIN fichas_cobro fc ON f.id = fc.ficha_id
     LEFT JOIN usuarios u ON f.uploaded_by = u.id
     WHERE f.id = ?`,
    [fichaId]
  );
  if (!rows.length) return null;

  const porFicha = await itemsDe([Number(fichaId)]);
  const items = porFicha[fichaId] || [];

  return {
    ...rows[0],
    cobrado: Number(rows[0].cobrado) === 1,
    items: items.map(i => ({
      tipo: i.tipo,
      descripcion: i.descripcion,
      cantidad: Number(i.cantidad),
      precio_unitario: Number(i.precio_unitario),
      subtotal: Number(i.cantidad) * Number(i.precio_unitario),
    })),
    total: items.reduce((s, i) => s + Number(i.cantidad) * Number(i.precio_unitario), 0),
  };
}

// Totales de lo que se esta mostrando, para el encabezado del PDF
function resumirTotales(datos) {
  const pendiente = datos.filter(r => !Number(r.cobrado))
                         .reduce((s, r) => s + Number(r.total_comanda || 0), 0);
  const cobrado   = datos.filter(r =>  Number(r.cobrado))
                         .reduce((s, r) => s + Number(r.total_comanda || 0), 0);
  return {
    comandas: datos.length,
    pendiente,
    cobrado,
    total: pendiente + cobrado,
    n_pendientes: datos.filter(r => !Number(r.cobrado)).length,
    n_cobradas:   datos.filter(r =>  Number(r.cobrado)).length,
  };
}

module.exports = { TOPE_PDF, construirFacturacion, comandaDeFicha, resumirTotales };

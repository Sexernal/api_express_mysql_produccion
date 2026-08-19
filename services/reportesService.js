// services/reportesService.js
//
// Consultas del panel de estadísticas. Viven aquí y no en el controlador
// porque las usan tres salidas: la pantalla web, el PDF y el CSV. Los tres
// deben mostrar exactamente los mismos números.
const db = require('../db');

// ─── Rango de fechas ─────────────────────────────────────────────────

const esYMD = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

function ymdLocal(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Interpreta ?desde=&hasta= del querystring. Sin parámetros, el mes actual.
// Se devuelve también el periodo ANTERIOR de la misma duración, que es
// contra lo que se compara cada cifra.
function resolverRango({ desde, hasta } = {}) {
  const hoy = new Date();

  if (!esYMD(desde) || !esYMD(hasta)) {
    const ini = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const fin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
    desde = ymdLocal(ini);
    hasta = ymdLocal(fin);
  }

  if (desde > hasta) [desde, hasta] = [hasta, desde];

  // El periodo anterior tiene la misma cantidad de días y termina justo
  // antes: comparar un mes contra una semana no diría nada.
  const [y1, m1, d1] = desde.split('-').map(Number);
  const [y2, m2, d2] = hasta.split('-').map(Number);
  const ini = new Date(y1, m1 - 1, d1);
  const fin = new Date(y2, m2 - 1, d2);
  const dias = Math.round((fin - ini) / 86400000) + 1;

  const finPrev = new Date(ini.getTime() - 86400000);
  const iniPrev = new Date(finPrev.getTime() - (dias - 1) * 86400000);

  return {
    desde, hasta, dias,
    prev_desde: ymdLocal(iniPrev),
    prev_hasta: ymdLocal(finPrev),
  };
}

// Variación porcentual contra el periodo anterior.
// null cuando antes no había nada: un "+100%" partiendo de cero engaña.
function variacion(actual, anterior) {
  const a = Number(actual) || 0;
  const b = Number(anterior) || 0;
  if (b === 0) return null;
  return Math.round(((a - b) / b) * 1000) / 10;
}

// ─── Métricas de un periodo ──────────────────────────────────────────
// Se ejecuta dos veces (periodo actual y anterior) para poder comparar.
// El +1 día en el límite superior incluye el día completo de `hasta`.
async function metricasDe(desde, hasta) {
  const [
    [[{ ingresos }]],
    [[{ comandas_cobradas }]],
    [[{ citas }]],
    [[{ fichas }]],
    [[{ propietarios_nuevos }]],
  ] = await Promise.all([
    db.query(
      `SELECT COALESCE(SUM(ci.cantidad * ci.precio_unitario), 0) AS ingresos
       FROM fichas_cobro fc
       JOIN comanda_items ci ON ci.ficha_id = fc.ficha_id
       WHERE fc.cobrado = 1 AND fc.cobrado_at >= ? AND fc.cobrado_at < DATE_ADD(?, INTERVAL 1 DAY)`,
      [desde, hasta]
    ),
    db.query(
      `SELECT COUNT(DISTINCT fc.ficha_id) AS comandas_cobradas
       FROM fichas_cobro fc
       WHERE fc.cobrado = 1 AND fc.cobrado_at >= ? AND fc.cobrado_at < DATE_ADD(?, INTERVAL 1 DAY)`,
      [desde, hasta]
    ),
    db.query(
      `SELECT COUNT(*) AS citas FROM citas
       WHERE fecha_inicio >= ? AND fecha_inicio < DATE_ADD(?, INTERVAL 1 DAY)`,
      [desde, hasta]
    ),
    db.query(
      `SELECT COUNT(*) AS fichas FROM fichas_medicas
       WHERE fecha >= ? AND fecha < DATE_ADD(?, INTERVAL 1 DAY)`,
      [desde, hasta]
    ),
    db.query(
      `SELECT COUNT(*) AS propietarios_nuevos FROM propietarios
       WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)`,
      [desde, hasta]
    ),
  ]);

  const ing = Number(ingresos) || 0;
  const com = Number(comandas_cobradas) || 0;

  return {
    ingresos: ing,
    comandas_cobradas: com,
    // Cuánto deja en promedio cada consulta que se cobró
    ticket_promedio: com > 0 ? Math.round(ing / com) : 0,
    citas: Number(citas) || 0,
    fichas: Number(fichas) || 0,
    propietarios_nuevos: Number(propietarios_nuevos) || 0,
  };
}

// ─── Desgloses del periodo actual ────────────────────────────────────

async function citasPorEstado(desde, hasta) {
  const [rows] = await db.query(
    `SELECT LOWER(estado) AS estado, COUNT(*) AS n FROM citas
     WHERE fecha_inicio >= ? AND fecha_inicio < DATE_ADD(?, INTERVAL 1 DAY)
     GROUP BY LOWER(estado) ORDER BY n DESC`,
    [desde, hasta]
  );
  return rows.map(r => ({ estado: r.estado, n: Number(r.n) }));
}

// Cuántas consultas atendió, cuántas fichas creó y cuánto facturó cada
// veterinario. Los ingresos se atribuyen a quien creó la ficha, que es
// quien hizo el trabajo, no a quien la cobró en recepción.
async function productividadVeterinarios(desde, hasta) {
  const [rows] = await db.query(
    `SELECT u.id, u.nombre, u.role,
            (SELECT COUNT(*) FROM fichas_medicas f
              WHERE f.uploaded_by = u.id
                AND f.fecha >= ? AND f.fecha < DATE_ADD(?, INTERVAL 1 DAY)) AS fichas,
            (SELECT COUNT(*) FROM citas c
              WHERE c.veterinario_id = u.id
                AND c.fecha_inicio >= ? AND c.fecha_inicio < DATE_ADD(?, INTERVAL 1 DAY)) AS citas,
            (SELECT COALESCE(SUM(ci.cantidad * ci.precio_unitario), 0)
               FROM fichas_medicas f
               JOIN fichas_cobro  fc ON fc.ficha_id = f.id AND fc.cobrado = 1
               JOIN comanda_items ci ON ci.ficha_id = f.id
              WHERE f.uploaded_by = u.id
                AND fc.cobrado_at >= ? AND fc.cobrado_at < DATE_ADD(?, INTERVAL 1 DAY)) AS ingresos
     FROM usuarios u
     WHERE u.role IN ('admin', 'superadmin')
     ORDER BY ingresos DESC, fichas DESC`,
    [desde, hasta, desde, hasta, desde, hasta]
  );
  // Quien no hizo nada en el periodo no aporta información a la tabla
  return rows
    .map(r => ({
      id: r.id, nombre: r.nombre,
      fichas: Number(r.fichas), citas: Number(r.citas), ingresos: Number(r.ingresos),
    }))
    .filter(r => r.fichas > 0 || r.citas > 0 || r.ingresos > 0);
}

// Propietarios atendidos en el periodo, separando los que ya habían
// venido antes de los que aparecen por primera vez.
async function clientesNuevosVsRecurrentes(desde, hasta) {
  const [[fila]] = await db.query(
    `SELECT
       COUNT(DISTINCT m.owner_id) AS atendidos,
       COUNT(DISTINCT CASE WHEN p.created_at >= ? THEN m.owner_id END) AS nuevos
     FROM fichas_medicas f
     JOIN mascotas     m ON f.mascota_id = m.id
     JOIN propietarios p ON m.owner_id   = p.id
     WHERE f.fecha >= ? AND f.fecha < DATE_ADD(?, INTERVAL 1 DAY)`,
    [desde, desde, hasta]
  );
  const atendidos = Number(fila?.atendidos) || 0;
  const nuevos    = Number(fila?.nuevos) || 0;
  return { atendidos, nuevos, recurrentes: Math.max(0, atendidos - nuevos) };
}

async function topServicios(desde, hasta, limite = 8) {
  const [rows] = await db.query(
    `SELECT ci.descripcion,
            SUM(ci.cantidad) AS cantidad,
            SUM(ci.cantidad * ci.precio_unitario) AS total
     FROM comanda_items ci
     JOIN fichas_cobro fc ON fc.ficha_id = ci.ficha_id AND fc.cobrado = 1
     WHERE fc.cobrado_at >= ? AND fc.cobrado_at < DATE_ADD(?, INTERVAL 1 DAY)
     GROUP BY ci.descripcion
     ORDER BY total DESC
     LIMIT ?`,
    [desde, hasta, limite]
  );
  return rows.map(r => ({
    descripcion: r.descripcion,
    cantidad: Number(r.cantidad),
    total: Number(r.total),
  }));
}

async function fichasPorTipo(desde, hasta) {
  const [rows] = await db.query(
    `SELECT LOWER(tipo) AS tipo, COUNT(*) AS n FROM fichas_medicas
     WHERE fecha >= ? AND fecha < DATE_ADD(?, INTERVAL 1 DAY)
     GROUP BY LOWER(tipo) ORDER BY n DESC`,
    [desde, hasta]
  );
  return rows.map(r => ({ tipo: r.tipo, n: Number(r.n) }));
}

// ─── Series de 6 meses (no dependen del rango) ───────────────────────

function ultimosMeses(n) {
  const meses = [];
  const hoy = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return meses;
}

// Los meses sin datos se rellenan con 0 para que la gráfica no salte
function rellenarMeses(rows, campo, n = 6) {
  const map = {};
  for (const r of rows) map[r.mes] = Number(r[campo]) || 0;
  return ultimosMeses(n).map(mes => ({ mes, valor: map[mes] ?? 0 }));
}

async function series() {
  const [[citas], [ingresos]] = await Promise.all([
    db.query(
      `SELECT DATE_FORMAT(fecha_inicio, '%Y-%m') AS mes, COUNT(*) AS n FROM citas
       WHERE fecha_inicio >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 5 MONTH)
       GROUP BY mes ORDER BY mes`
    ),
    db.query(
      `SELECT DATE_FORMAT(fc.cobrado_at, '%Y-%m') AS mes,
              SUM(ci.cantidad * ci.precio_unitario) AS total
       FROM fichas_cobro fc
       JOIN comanda_items ci ON ci.ficha_id = fc.ficha_id
       WHERE fc.cobrado = 1 AND fc.cobrado_at IS NOT NULL
         AND fc.cobrado_at >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 5 MONTH)
       GROUP BY mes ORDER BY mes`
    ),
  ]);
  return {
    citas_por_mes:    rellenarMeses(citas, 'n'),
    ingresos_por_mes: rellenarMeses(ingresos, 'total'),
  };
}

// ─── Cifras que no dependen del rango ────────────────────────────────

async function globales() {
  const [
    [[{ propietarios }]], [[{ mascotas }]],
    [[{ pendiente_cobro }]], [[vac]], [mascotasPorEspecie],
  ] = await Promise.all([
    db.query('SELECT COUNT(*) AS propietarios FROM propietarios'),
    db.query('SELECT COUNT(*) AS mascotas FROM mascotas'),
    db.query(
      `SELECT COALESCE(SUM(ci.cantidad * ci.precio_unitario), 0) AS pendiente_cobro
       FROM comanda_items ci
       LEFT JOIN fichas_cobro fc ON fc.ficha_id = ci.ficha_id
       WHERE COALESCE(fc.cobrado, 0) = 0`
    ),
    db.query(
      `SELECT
         COALESCE(SUM(fecha_proxima < CURDATE()), 0) AS vencidas,
         COALESCE(SUM(fecha_proxima >= CURDATE() AND fecha_proxima <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)), 0) AS proximas
       FROM vacunas WHERE ciclo_completado = 0 AND fecha_proxima IS NOT NULL`
    ),
    db.query(
      `SELECT COALESCE(NULLIF(TRIM(especie), ''), 'Sin especie') AS especie, COUNT(*) AS n
       FROM mascotas GROUP BY especie ORDER BY n DESC`
    ),
  ]);

  return {
    propietarios: Number(propietarios),
    mascotas: Number(mascotas),
    pendiente_cobro: Number(pendiente_cobro),
    vacunas_vencidas: Number(vac.vencidas),
    vacunas_proximas: Number(vac.proximas),
    mascotas_por_especie: mascotasPorEspecie.map(r => ({ especie: r.especie, n: Number(r.n) })),
  };
}

// ─── Armado completo ─────────────────────────────────────────────────
// Única entrada del módulo: la usan la pantalla, el PDF y el CSV.
async function construirReporte(query = {}) {
  const rango = resolverRango(query);

  const [actual, anterior, estados, vets, clientes, top, tipos, ser, glob] = await Promise.all([
    metricasDe(rango.desde, rango.hasta),
    metricasDe(rango.prev_desde, rango.prev_hasta),
    citasPorEstado(rango.desde, rango.hasta),
    productividadVeterinarios(rango.desde, rango.hasta),
    clientesNuevosVsRecurrentes(rango.desde, rango.hasta),
    topServicios(rango.desde, rango.hasta),
    fichasPorTipo(rango.desde, rango.hasta),
    series(),
    globales(),
  ]);

  // Citas que no se llegaron a atender, sobre el total del periodo
  const canceladas = estados.find(e => e.estado === 'cancelada')?.n || 0;
  const totalCitas = estados.reduce((s, e) => s + e.n, 0);

  return {
    rango,
    totales: {
      ...actual,
      ...glob,
      citas_canceladas: canceladas,
      tasa_cancelacion: totalCitas > 0 ? Math.round((canceladas / totalCitas) * 1000) / 10 : 0,
    },
    anterior,
    variaciones: {
      ingresos:            variacion(actual.ingresos, anterior.ingresos),
      citas:               variacion(actual.citas, anterior.citas),
      fichas:              variacion(actual.fichas, anterior.fichas),
      ticket_promedio:     variacion(actual.ticket_promedio, anterior.ticket_promedio),
      propietarios_nuevos: variacion(actual.propietarios_nuevos, anterior.propietarios_nuevos),
    },
    clientes,
    citas_por_estado: estados,
    productividad: vets,
    top_servicios: top,
    fichas_por_tipo: tipos,
    ...ser,
  };
}

module.exports = { resolverRango, variacion, construirReporte };

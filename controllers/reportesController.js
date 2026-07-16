// controllers/reportesController.js
// Panel de estadísticas/reportes — SOLO admin (protegido en la ruta con requireAdmin).
const db = require('../db');

// Devuelve las claves 'YYYY-MM' de los últimos n meses (incluido el actual)
function ultimosMeses(n) {
  const meses = [];
  const hoy = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return meses;
}

// Rellena con 0 los meses sin datos para que las gráficas siempre tengan 6 barras
function rellenarMeses(rows, campo, n = 6) {
  const map = {};
  for (const r of rows) map[r.mes] = Number(r[campo]) || 0;
  return ultimosMeses(n).map(mes => ({ mes, valor: map[mes] ?? 0 }));
}

const ReportesController = {

  // GET /reportes/resumen
  async resumen(req, res) {
    try {
      const [
        [[{ total_propietarios }]],
        [[{ total_mascotas }]],
        [citasEstadoMes],
        [citasPorMes],
        [ingresosPorMes],
        [[{ ingresos_mes }]],
        [[{ pendiente_cobro }]],
        [topServicios],
        [mascotasPorEspecie],
        [fichasPorTipoMes],
        [[vacunasResumen]],
        [[{ fichas_mes }]],
      ] = await Promise.all([
        db.query('SELECT COUNT(*) AS total_propietarios FROM propietarios'),
        db.query('SELECT COUNT(*) AS total_mascotas FROM mascotas'),

        // Citas del mes actual, por estado
        db.query(
          `SELECT LOWER(estado) AS estado, COUNT(*) AS n
           FROM citas
           WHERE fecha_inicio >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
             AND fecha_inicio <  DATE_ADD(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 1 MONTH)
           GROUP BY LOWER(estado)`
        ),

        // Citas por mes (últimos 6 meses)
        db.query(
          `SELECT DATE_FORMAT(fecha_inicio, '%Y-%m') AS mes, COUNT(*) AS n
           FROM citas
           WHERE fecha_inicio >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 5 MONTH)
           GROUP BY mes ORDER BY mes`
        ),

        // Ingresos cobrados por mes (últimos 6 meses)
        db.query(
          `SELECT DATE_FORMAT(fc.cobrado_at, '%Y-%m') AS mes,
                  SUM(ci.cantidad * ci.precio_unitario) AS total
           FROM fichas_cobro fc
           JOIN comanda_items ci ON ci.ficha_id = fc.ficha_id
           WHERE fc.cobrado = 1 AND fc.cobrado_at IS NOT NULL
             AND fc.cobrado_at >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 5 MONTH)
           GROUP BY mes ORDER BY mes`
        ),

        // Ingresos cobrados del mes actual
        db.query(
          `SELECT COALESCE(SUM(ci.cantidad * ci.precio_unitario), 0) AS ingresos_mes
           FROM fichas_cobro fc
           JOIN comanda_items ci ON ci.ficha_id = fc.ficha_id
           WHERE fc.cobrado = 1 AND fc.cobrado_at IS NOT NULL
             AND fc.cobrado_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`
        ),

        // Total pendiente de cobro (comandas con ítems y sin cobrar)
        db.query(
          `SELECT COALESCE(SUM(ci.cantidad * ci.precio_unitario), 0) AS pendiente_cobro
           FROM comanda_items ci
           LEFT JOIN fichas_cobro fc ON fc.ficha_id = ci.ficha_id
           WHERE COALESCE(fc.cobrado, 0) = 0`
        ),

        // Top 5 servicios/ítems más facturados (histórico)
        db.query(
          `SELECT descripcion,
                  SUM(cantidad) AS cantidad,
                  SUM(cantidad * precio_unitario) AS total
           FROM comanda_items
           GROUP BY descripcion
           ORDER BY total DESC
           LIMIT 5`
        ),

        // Mascotas por especie
        db.query(
          `SELECT COALESCE(NULLIF(TRIM(especie), ''), 'Sin especie') AS especie, COUNT(*) AS n
           FROM mascotas
           GROUP BY especie
           ORDER BY n DESC`
        ),

        // Fichas del mes actual por tipo
        db.query(
          `SELECT LOWER(tipo) AS tipo, COUNT(*) AS n
           FROM fichas_medicas
           WHERE fecha >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
           GROUP BY LOWER(tipo)
           ORDER BY n DESC`
        ),

        // Vacunas: vencidas y próximas (30 días), de ciclos no completados
        db.query(
          `SELECT
             COALESCE(SUM(fecha_proxima < CURDATE()), 0) AS vencidas,
             COALESCE(SUM(fecha_proxima >= CURDATE() AND fecha_proxima <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)), 0) AS proximas
           FROM vacunas
           WHERE ciclo_completado = 0 AND fecha_proxima IS NOT NULL`
        ),

        // Fichas creadas este mes
        db.query(
          `SELECT COUNT(*) AS fichas_mes
           FROM fichas_medicas
           WHERE fecha >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`
        ),
      ]);

      const citasMesTotal = citasEstadoMes.reduce((s, r) => s + Number(r.n), 0);

      res.json({
        success: true,
        data: {
          totales: {
            propietarios: Number(total_propietarios),
            mascotas: Number(total_mascotas),
            citas_mes: citasMesTotal,
            fichas_mes: Number(fichas_mes),
            ingresos_mes: Number(ingresos_mes),
            pendiente_cobro: Number(pendiente_cobro),
            vacunas_vencidas: Number(vacunasResumen.vencidas),
            vacunas_proximas: Number(vacunasResumen.proximas),
          },
          citas_por_estado_mes: citasEstadoMes.map(r => ({ estado: r.estado, n: Number(r.n) })),
          citas_por_mes: rellenarMeses(citasPorMes, 'n'),
          ingresos_por_mes: rellenarMeses(ingresosPorMes, 'total'),
          top_servicios: topServicios.map(r => ({
            descripcion: r.descripcion,
            cantidad: Number(r.cantidad),
            total: Number(r.total),
          })),
          mascotas_por_especie: mascotasPorEspecie.map(r => ({ especie: r.especie, n: Number(r.n) })),
          fichas_por_tipo_mes: fichasPorTipoMes.map(r => ({ tipo: r.tipo, n: Number(r.n) })),
        },
      });
    } catch (err) {
      console.error('Error en reportes/resumen:', err);
      res.status(500).json({ success: false, message: 'Error al generar el reporte', error: err.message });
    }
  },
};

module.exports = ReportesController;

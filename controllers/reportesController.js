// controllers/reportesController.js
// Panel de estadísticas — solo super admin (se aplica en la ruta con
// requirePermiso('reportes.ver')).
//
// Tres salidas sobre los MISMOS datos: pantalla, PDF y CSV. Todas piden el
// reporte a reportesService, así que los tres siempre coinciden.
const { construirReporte } = require('../services/reportesService');
const { generarReportePDF } = require('../services/reportePdf');

// Nombre del archivo con el rango incluido, para que al bajar varios no se
// pisen entre ellos en la carpeta de descargas.
const nombreArchivo = (rango, ext) =>
  `reporte-${rango.desde}_a_${rango.hasta}.${ext}`;

// Escapado CSV: comillas dobles alrededor y las internas duplicadas, que es
// lo que entiende Excel.
const celdaCSV = (v) => {
  const s = String(v ?? '');
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const filaCSV = (arr) => arr.map(celdaCSV).join(';');

const ReportesController = {

  // GET /reportes/resumen?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
  // Sin parámetros devuelve el mes actual.
  async resumen(req, res) {
    try {
      res.json({ success: true, data: await construirReporte(req.query) });
    } catch (err) {
      console.error('Error en reportes/resumen:', err);
      res.status(500).json({ success: false, message: 'Error al generar el reporte', error: err.message });
    }
  },

  // GET /reportes/pdf?desde=&hasta=  → descarga
  async pdf(req, res) {
    try {
      const reporte = await construirReporte(req.query);
      const buffer  = await generarReportePDF(reporte, {
        generadoPor: req.user?.nombre || req.user?.email || '',
      });

      // attachment (no inline): el navegador lo baja en vez de abrirlo,
      // que es justamente lo que se pidió.
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo(reporte.rango, 'pdf')}"`);
      res.setHeader('Content-Length', buffer.length);
      res.send(buffer);
    } catch (err) {
      console.error('Error en reportes/pdf:', err);
      res.status(500).json({ success: false, message: 'Error al generar el PDF', error: err.message });
    }
  },

  // GET /reportes/csv?desde=&hasta=  → descarga para Excel
  async csv(req, res) {
    try {
      const r = await construirReporte(req.query);
      const t = r.totales, v = r.variaciones;
      const pct = (x) => (x == null ? '' : `${x}%`);

      const lineas = [
        filaCSV(['Reporte de estadísticas — Veterinaria Cañas']),
        filaCSV(['Periodo', `${r.rango.desde} a ${r.rango.hasta}`]),
        filaCSV(['Comparado contra', `${r.rango.prev_desde} a ${r.rango.prev_hasta}`]),
        '',
        filaCSV(['RESUMEN DEL PERIODO', 'Valor', 'Periodo anterior', 'Variación']),
        filaCSV(['Ingresos cobrados',   t.ingresos,            r.anterior.ingresos,            pct(v.ingresos)]),
        filaCSV(['Ticket promedio',     t.ticket_promedio,     r.anterior.ticket_promedio,     pct(v.ticket_promedio)]),
        filaCSV(['Comandas cobradas',   t.comandas_cobradas,   r.anterior.comandas_cobradas,   '']),
        filaCSV(['Citas',               t.citas,               r.anterior.citas,               pct(v.citas)]),
        filaCSV(['Fichas creadas',      t.fichas,              r.anterior.fichas,              pct(v.fichas)]),
        filaCSV(['Clientes nuevos',     t.propietarios_nuevos, r.anterior.propietarios_nuevos, pct(v.propietarios_nuevos)]),
        filaCSV(['Tasa de cancelación', `${t.tasa_cancelacion}%`, '', '']),
        '',
        filaCSV(['RENDIMIENTO POR VETERINARIO', 'Fichas', 'Citas', 'Facturado']),
        ...r.productividad.map(p => filaCSV([p.nombre, p.fichas, p.citas, p.ingresos])),
        '',
        filaCSV(['SERVICIOS MÁS FACTURADOS', 'Cantidad', 'Total']),
        ...r.top_servicios.map(s => filaCSV([s.descripcion, s.cantidad, s.total])),
        '',
        filaCSV(['CITAS POR ESTADO', 'Cantidad']),
        ...r.citas_por_estado.map(c => filaCSV([c.estado, c.n])),
        '',
        filaCSV(['FICHAS POR TIPO', 'Cantidad']),
        ...r.fichas_por_tipo.map(f => filaCSV([f.tipo, f.n])),
        '',
        filaCSV(['EVOLUCIÓN (ÚLTIMOS 6 MESES)', 'Citas', 'Ingresos']),
        ...r.citas_por_mes.map((c, i) => filaCSV([c.mes, c.valor, r.ingresos_por_mes[i]?.valor ?? 0])),
        '',
        filaCSV(['SITUACIÓN GENERAL', 'Valor']),
        filaCSV(['Pendiente de cobro',    t.pendiente_cobro]),
        filaCSV(['Vacunas vencidas',      t.vacunas_vencidas]),
        filaCSV(['Vacunas por vencer',    t.vacunas_proximas]),
        filaCSV(['Propietarios en total', t.propietarios]),
        filaCSV(['Mascotas en total',     t.mascotas]),
      ];

      // El BOM inicial hace que Excel reconozca UTF-8 y no destroce las
      // tildes ni la ñ al abrir el archivo con doble clic.
      const contenido = '﻿' + lineas.join('\r\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo(r.rango, 'csv')}"`);
      res.send(contenido);
    } catch (err) {
      console.error('Error en reportes/csv:', err);
      res.status(500).json({ success: false, message: 'Error al generar el CSV', error: err.message });
    }
  },
};

module.exports = ReportesController;

// services/reportePdf.js
//
// PDF del panel de estadísticas. Las piezas de dibujo (documento, encabezado,
// secciones, tablas, tarjetas, pie) viven en pdfBase y se comparten con el
// consolidado: así la paginación y el pie se arreglan en un solo lugar.
const {
  MARGEN, COLORES, CRC, fechaCorta,
  crearDocumento, encabezado, seccion, tabla, tarjetas, pieDePagina,
} = require('./pdfBase');

const { GRIS, VERDE, ROJO } = COLORES;

// "+12,5%" / "-8%" / "" cuando no hay con qué comparar
const varTexto  = (v) => (v == null ? '' : `${v > 0 ? '+' : ''}${v}%`);
const varColor  = (v) => (v == null ? GRIS : v > 0 ? VERDE : v < 0 ? ROJO : GRIS);

function hoyYMD() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const capitalizar = (s) =>
  String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);

/**
 * Devuelve un Buffer con el PDF del reporte.
 */
function generarReportePDF(rep, { clinica = 'Veterinaria Cañas', generadoPor = '' } = {}) {
  const { doc, listo, ancho } = crearDocumento();

  encabezado(doc, {
    titulo: clinica,
    subtitulo: 'Reporte de estadísticas',
    derechaAbajo: `${fechaCorta(rep.rango.desde)}  al  ${fechaCorta(rep.rango.hasta)}`,
  });

  // ── Indicadores del periodo ──
  seccion(doc, 'Resumen del periodo');

  const t = rep.totales;
  const v = rep.variaciones;
  // El verde/rojo va en la variación (colorNota), no en el número: el dato
  // en sí no es "bueno" ni "malo", lo que mejora o empeora es la comparación.
  tarjetas(doc, [
    { etiqueta: 'Ingresos cobrados',   valor: CRC(t.ingresos),               nota: varTexto(v.ingresos),            colorNota: varColor(v.ingresos) },
    { etiqueta: 'Ticket promedio',     valor: CRC(t.ticket_promedio),        nota: varTexto(v.ticket_promedio),     colorNota: varColor(v.ticket_promedio) },
    { etiqueta: 'Citas del periodo',   valor: String(t.citas),               nota: varTexto(v.citas),               colorNota: varColor(v.citas) },
    { etiqueta: 'Fichas creadas',      valor: String(t.fichas),              nota: varTexto(v.fichas),              colorNota: varColor(v.fichas) },
    { etiqueta: 'Clientes nuevos',     valor: String(t.propietarios_nuevos), nota: varTexto(v.propietarios_nuevos), colorNota: varColor(v.propietarios_nuevos) },
    { etiqueta: 'Tasa de cancelación', valor: `${t.tasa_cancelacion}%` },
  ], { columnas: 2 });

  doc.fontSize(8).fillColor(GRIS).font('Helvetica')
     .text(`Los porcentajes comparan contra el periodo anterior de la misma duración `
         + `(${fechaCorta(rep.rango.prev_desde)} al ${fechaCorta(rep.rango.prev_hasta)}).`,
           MARGEN, doc.y, { width: ancho });
  doc.moveDown(1.2);

  // ── Rendimiento por veterinario ──
  if (rep.productividad.length) {
    seccion(doc, 'Rendimiento por veterinario');
    tabla(doc, {
      cabeceras: ['Veterinario', 'Fichas', 'Citas', 'Facturado'],
      proporciones: [0.44, 0.15, 0.15, 0.26],
      filas: rep.productividad.map(p => [p.nombre, String(p.fichas), String(p.citas), CRC(p.ingresos)]),
    });
    doc.moveDown(0.6);
  }

  // ── Servicios más facturados ──
  if (rep.top_servicios.length) {
    seccion(doc, 'Servicios más facturados');
    tabla(doc, {
      cabeceras: ['Servicio', 'Cantidad', 'Total'],
      proporciones: [0.58, 0.17, 0.25],
      filas: rep.top_servicios.map(s => [s.descripcion, String(s.cantidad), CRC(s.total)]),
    });
    doc.moveDown(0.6);
  }

  // ── Citas por estado ──
  if (rep.citas_por_estado.length) {
    seccion(doc, 'Citas por estado');
    tabla(doc, {
      cabeceras: ['Estado', 'Cantidad'],
      proporciones: [0.75, 0.25],
      filas: rep.citas_por_estado.map(c => [capitalizar(c.estado), String(c.n)]),
    });
    doc.moveDown(0.6);
  }

  // ── Clientes y situación general ──
  seccion(doc, 'Clientes y situación general');
  tabla(doc, {
    cabeceras: ['Concepto', 'Valor'],
    proporciones: [0.7, 0.3],
    filas: [
      ['Propietarios atendidos en el periodo', String(rep.clientes.atendidos)],
      ['  · de ellos, clientes nuevos',        String(rep.clientes.nuevos)],
      ['  · de ellos, ya venían antes',        String(rep.clientes.recurrentes)],
      ['Pendiente de cobro (histórico)',       CRC(t.pendiente_cobro)],
      ['Vacunas vencidas',                     String(t.vacunas_vencidas)],
      ['Vacunas por vencer (30 días)',         String(t.vacunas_proximas)],
      ['Propietarios registrados en total',    String(t.propietarios)],
      ['Mascotas registradas en total',        String(t.mascotas)],
    ],
  });

  pieDePagina(doc, {
    izquierda: `Generado el ${fechaCorta(hoyYMD())}${generadoPor ? ` por ${generadoPor}` : ''}`,
  });

  doc.end();
  return listo;
}

module.exports = { generarReportePDF };

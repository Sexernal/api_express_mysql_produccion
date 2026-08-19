// services/reportePdf.js
//
// Genera el PDF del reporte con pdfkit, en el servidor.
//
// Se hace aquí y no con window.print() del navegador porque el usuario pidió
// una DESCARGA, no un diálogo de impresión. Además el resultado es idéntico
// en cualquier equipo, no depende de la configuración de márgenes de quien
// lo genere.
const PDFDocument = require('pdfkit');

// ─── Paleta y medidas ────────────────────────────────────────────────
const AZUL   = '#0b1220';
const GRIS   = '#6b7280';
const LINEA  = '#e5e7eb';
const VERDE  = '#059669';
const ROJO   = '#dc2626';
const MARGEN = 45;

const CRC = (n) =>
  `CRC ${Number(n || 0).toLocaleString('es-CR', { maximumFractionDigits: 0 })}`;

const fechaLarga = (ymd) => {
  if (!ymd) return '—';
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
};

// "+12,5%" / "-8%" / "" cuando no hay con qué comparar
const varTexto = (v) => (v == null ? '' : `${v > 0 ? '+' : ''}${v}%`);
const varColor = (v) => (v == null ? GRIS : v > 0 ? VERDE : v < 0 ? ROJO : GRIS);

/**
 * Devuelve un Buffer con el PDF ya armado.
 * Se acumula en memoria en vez de escribir a disco: el reporte pesa unos
 * pocos KB y así no hay archivos temporales que limpiar.
 */
function generarReportePDF(rep, { clinica = 'Veterinaria Cañas', generadoPor = '' } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGEN, bufferPages: true });
    const trozos = [];
    doc.on('data', (t) => trozos.push(t));
    doc.on('end', () => resolve(Buffer.concat(trozos)));
    doc.on('error', reject);

    const ancho = doc.page.width - MARGEN * 2;

    // ── Encabezado ──
    doc.rect(0, 0, doc.page.width, 88).fill(AZUL);
    doc.fillColor('#ffffff').fontSize(19).font('Helvetica-Bold')
       .text(clinica, MARGEN, 26);
    doc.fontSize(11).font('Helvetica').fillColor('#9fb0c8')
       .text('Reporte de estadísticas', MARGEN, 51);
    doc.fontSize(9)
       .text(`${fechaLarga(rep.rango.desde)}  al  ${fechaLarga(rep.rango.hasta)}`,
             MARGEN, 51, { width: ancho, align: 'right' });
    doc.y = 110;

    // ── Bloque de indicadores, 2 columnas ──
    seccion(doc, 'Resumen del periodo');

    const t = rep.totales;
    const v = rep.variaciones;
    const tarjetas = [
      ['Ingresos cobrados',   CRC(t.ingresos),                v.ingresos],
      ['Ticket promedio',     CRC(t.ticket_promedio),         v.ticket_promedio],
      ['Citas del periodo',   String(t.citas),                v.citas],
      ['Fichas creadas',      String(t.fichas),               v.fichas],
      ['Clientes nuevos',     String(t.propietarios_nuevos),  v.propietarios_nuevos],
      ['Tasa de cancelación', `${t.tasa_cancelacion}%`,       null],
    ];

    const colAncho = ancho / 2 - 6;
    let y = doc.y;
    tarjetas.forEach((tar, i) => {
      const x = MARGEN + (i % 2) * (colAncho + 12);
      if (i % 2 === 0 && i > 0) y += 46;
      dibujarTarjeta(doc, x, y, colAncho, tar);
    });
    doc.y = y + 60;

    // ── Comparación explícita ──
    doc.fontSize(8).fillColor(GRIS).font('Helvetica')
       .text(`Los porcentajes comparan contra el periodo anterior de la misma duración `
           + `(${fechaLarga(rep.rango.prev_desde)} al ${fechaLarga(rep.rango.prev_hasta)}).`,
             MARGEN, doc.y, { width: ancho });
    doc.moveDown(1.2);

    // ── Productividad por veterinario ──
    if (rep.productividad.length) {
      seccion(doc, 'Rendimiento por veterinario');
      tabla(doc, ancho,
        ['Veterinario', 'Fichas', 'Citas', 'Facturado'],
        [0.44, 0.15, 0.15, 0.26],
        rep.productividad.map(p => [p.nombre, String(p.fichas), String(p.citas), CRC(p.ingresos)])
      );
      doc.moveDown(0.8);
    }

    // ── Servicios más facturados ──
    if (rep.top_servicios.length) {
      seccion(doc, 'Servicios más facturados');
      tabla(doc, ancho,
        ['Servicio', 'Cantidad', 'Total'],
        [0.58, 0.17, 0.25],
        rep.top_servicios.map(s => [s.descripcion, String(s.cantidad), CRC(s.total)])
      );
      doc.moveDown(0.8);
    }

    // ── Citas por estado ──
    if (rep.citas_por_estado.length) {
      seccion(doc, 'Citas por estado');
      tabla(doc, ancho, ['Estado', 'Cantidad'], [0.75, 0.25],
        rep.citas_por_estado.map(c => [capitalizar(c.estado), String(c.n)]));
      doc.moveDown(0.8);
    }

    // ── Clientes y situación general ──
    seccion(doc, 'Clientes y situación general');
    tabla(doc, ancho, ['Concepto', 'Valor'], [0.7, 0.3], [
      ['Propietarios atendidos en el periodo', String(rep.clientes.atendidos)],
      ['  · de ellos, clientes nuevos',        String(rep.clientes.nuevos)],
      ['  · de ellos, ya venían antes',        String(rep.clientes.recurrentes)],
      ['Pendiente de cobro (histórico)',       CRC(t.pendiente_cobro)],
      ['Vacunas vencidas',                     String(t.vacunas_vencidas)],
      ['Vacunas por vencer (30 días)',         String(t.vacunas_proximas)],
      ['Propietarios registrados en total',    String(t.propietarios)],
      ['Mascotas registradas en total',        String(t.mascotas)],
    ]);

    // ── Pie en todas las páginas ──
    const paginas = doc.bufferedPageRange();
    for (let i = 0; i < paginas.count; i++) {
      doc.switchToPage(paginas.start + i);
      const yPie = doc.page.height - 34;

      // El pie va por DEBAJO del margen inferior. pdfkit salta a una página
      // nueva en cuanto un texto empieza pasado ese margen —aunque lleve
      // lineBreak:false—, así que lo anulamos mientras lo dibujamos y lo
      // dejamos como estaba. Sin esto se generaba una página en blanco por
      // cada línea del pie.
      const margenAbajo = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;

      doc.moveTo(MARGEN, yPie - 8).lineTo(doc.page.width - MARGEN, yPie - 8)
         .strokeColor(LINEA).lineWidth(0.5).stroke();
      doc.fontSize(7.5).fillColor(GRIS).font('Helvetica')
         .text(`Generado el ${fechaLarga(hoyYMD())}${generadoPor ? ` por ${generadoPor}` : ''}`,
               MARGEN, yPie, { width: ancho / 2, lineBreak: false })
         .text(`Página ${i + 1} de ${paginas.count}`,
               MARGEN + ancho / 2, yPie, { width: ancho / 2, align: 'right', lineBreak: false });

      doc.page.margins.bottom = margenAbajo;
    }

    doc.end();
  });
}

// ─── Piezas de dibujo ────────────────────────────────────────────────

function hoyYMD() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const capitalizar = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);

function seccion(doc, titulo) {
  // Si la sección no cabe en lo que queda de página, se salta a la siguiente
  if (doc.y > doc.page.height - 130) doc.addPage();
  doc.fontSize(12).font('Helvetica-Bold').fillColor(AZUL).text(titulo, MARGEN, doc.y);
  doc.moveTo(MARGEN, doc.y + 3).lineTo(doc.page.width - MARGEN, doc.y + 3)
     .strokeColor(LINEA).lineWidth(1).stroke();
  doc.moveDown(0.8);
}

function dibujarTarjeta(doc, x, y, ancho, [etiqueta, valor, varPct]) {
  doc.roundedRect(x, y, ancho, 40, 5).fillAndStroke('#f9fafb', LINEA);
  doc.fontSize(7.5).font('Helvetica').fillColor(GRIS)
     .text(etiqueta.toUpperCase(), x + 10, y + 7, { width: ancho - 20 });
  doc.fontSize(14).font('Helvetica-Bold').fillColor(AZUL)
     .text(valor, x + 10, y + 19, { width: ancho - 70, lineBreak: false });
  const txt = varTexto(varPct);
  if (txt) {
    doc.fontSize(9).font('Helvetica-Bold').fillColor(varColor(varPct))
       .text(txt, x + ancho - 62, y + 22, { width: 52, align: 'right' });
  }
}

function tabla(doc, ancho, cabeceras, proporciones, filas) {
  const anchos = proporciones.map(p => ancho * p);
  const alto   = 17;

  const encabezado = () => {
    const y = doc.y;
    doc.rect(MARGEN, y, ancho, alto).fill('#f3f4f6');
    doc.fontSize(8).font('Helvetica-Bold').fillColor(AZUL);
    let x = MARGEN;
    cabeceras.forEach((c, i) => {
      doc.text(c, x + 6, y + 5, { width: anchos[i] - 12, align: i === 0 ? 'left' : 'right', lineBreak: false });
      x += anchos[i];
    });
    doc.y = y + alto;
  };

  encabezado();
  doc.font('Helvetica').fontSize(8.5);

  filas.forEach((fila, idx) => {
    // Salto de página con la cabecera repetida, para que la tabla se siga
    // entendiendo en la página siguiente
    if (doc.y > doc.page.height - 60) {
      doc.addPage();
      encabezado();
      doc.font('Helvetica').fontSize(8.5);
    }
    const y = doc.y;
    if (idx % 2 === 1) doc.rect(MARGEN, y, ancho, alto).fill('#fafafa');
    doc.fillColor('#111827');
    let x = MARGEN;
    fila.forEach((celda, i) => {
      doc.text(String(celda), x + 6, y + 5,
        { width: anchos[i] - 12, align: i === 0 ? 'left' : 'right', lineBreak: false, ellipsis: true });
      x += anchos[i];
    });
    doc.y = y + alto;
  });

  doc.moveTo(MARGEN, doc.y).lineTo(doc.page.width - MARGEN, doc.y)
     .strokeColor(LINEA).lineWidth(0.5).stroke();
  doc.moveDown(0.4);
}

module.exports = { generarReportePDF };

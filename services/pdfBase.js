// services/pdfBase.js
//
// Piezas compartidas para generar PDF con pdfkit. Las usan reportePdf
// (estadísticas) y consolidadoPdf (informe diario).
//
// Vive aparte para que la paginación, el pie y las tablas se arreglen en un
// solo lugar: el fallo del pie que generaba páginas en blanco ya costó una
// vez, y no conviene tenerlo duplicado.
const PDFDocument = require('pdfkit');

// ─── Paleta y medidas ────────────────────────────────────────────────
const AZUL   = '#0b1220';
const GRIS   = '#6b7280';
const LINEA  = '#e5e7eb';
const SUAVE  = '#f9fafb';
const VERDE  = '#059669';
const ROJO   = '#dc2626';
const AMBAR  = '#b45309';
const MARGEN = 45;

const COLORES = { AZUL, GRIS, LINEA, SUAVE, VERDE, ROJO, AMBAR };

// ─── Formato ─────────────────────────────────────────────────────────

// "CRC" y no "₡": las fuentes base de pdfkit (Helvetica) no traen el colón,
// y saldría como un cuadrito. Lo mismo vale para cualquier emoji.
const CRC = (n) =>
  `CRC ${Number(n || 0).toLocaleString('es-CR', { maximumFractionDigits: 0 })}`;

const fechaCorta = (ymd) => {
  if (!ymd) return '—';
  const [y, m, d] = String(ymd).slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : '—';
};

const MESES = ['enero','febrero','marzo','abril','mayo','junio',
               'julio','agosto','septiembre','octubre','noviembre','diciembre'];

const fechaLarga = (ymd) => {
  if (!ymd) return '—';
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  // El mes se usa como índice de MESES: fuera de 1-12 saldría "undefined"
  // impreso en el documento, así que se descarta la fecha entera.
  if (!y || !m || !d || m < 1 || m > 12) return '—';
  return `${d} de ${MESES[m - 1]} de ${y}`;
};

// pdfkit con las fuentes base no dibuja emoji ni símbolos fuera de WinAnsi:
// salen como cuadritos o huecos. Se limpian antes de escribir.
//
// El colón (₡) tampoco está en WinAnsi, y es probable que alguien lo escriba
// a mano en una nota o en el nombre de un servicio, así que en vez de
// borrarlo se cambia por "CRC" — igual que hace la función CRC().
// Los acentos, la ñ, la diéresis, el grado (°) y el guion largo (—) SÍ están
// en WinAnsi y se conservan: son parte del texto en español.
//
// La sangría del principio se respeta: hay filas que la usan a propósito para
// colgar de la de arriba ("  · de ellos, clientes nuevos"). Si se recortara,
// esas filas quedarían al mismo nivel que su encabezado y el informe mentiría.
// Se come también el espacio que rodeaba al emoji: si no, donde había
// "Texto 🐶 más" quedaría un hueco doble.
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2600}-\u{27BF}\u{FE0F}]/u;
const EMOJI_CON_ESPACIOS = new RegExp(` ?(?:${EMOJI.source})+ ?`, 'gu');

const limpiar = (s) => {
  const texto   = String(s ?? '');
  const sangria = texto.match(/^ */)[0];
  const cuerpo  = texto
    .replace(/₡\s?/g, 'CRC ')
    .replace(EMOJI_CON_ESPACIOS, ' ')
    .trim();
  return sangria + cuerpo;
};

// Opciones para texto que DEBE quedar en una sola línea.
//
// lineBreak:false NO alcanza: pdfkit igual parte el texto largo en varias
// líneas y se pisa con lo que viene debajo. Hay que darle además un `height`
// menor que dos renglones; recién ahí recorta con puntos suspensivos.
// Comprobado contra pdfkit 0.17.2.
const unaLinea = (tam, extra = {}) => ({
  lineBreak: false,
  ellipsis: true,
  height: tam * 1.35,
  ...extra,
});

// ─── Documento ───────────────────────────────────────────────────────

// Devuelve el doc y una promesa que resuelve al Buffer final.
// Se acumula en memoria: estos informes pesan pocos KB y así no quedan
// archivos temporales que limpiar.
function crearDocumento() {
  const doc = new PDFDocument({ size: 'A4', margin: MARGEN, bufferPages: true });
  const trozos = [];
  const listo = new Promise((resolve, reject) => {
    doc.on('data', (t) => trozos.push(t));
    doc.on('end', () => resolve(Buffer.concat(trozos)));
    doc.on('error', reject);
  });
  return { doc, listo, ancho: doc.page.width - MARGEN * 2 };
}

// Banda superior de la primera página
function encabezado(doc, { titulo, subtitulo, derechaArriba, derechaAbajo }) {
  const ancho = doc.page.width - MARGEN * 2;
  doc.rect(0, 0, doc.page.width, 88).fill(AZUL);
  doc.fillColor('#ffffff').fontSize(19).font('Helvetica-Bold')
     .text(limpiar(titulo), MARGEN, 26, unaLinea(19));
  doc.fontSize(11).font('Helvetica').fillColor('#9fb0c8')
     .text(limpiar(subtitulo), MARGEN, 51, unaLinea(11));
  if (derechaArriba) {
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#ffffff')
       .text(limpiar(derechaArriba), MARGEN, 28, unaLinea(11, { width: ancho, align: 'right' }));
  }
  if (derechaAbajo) {
    doc.fontSize(8.5).font('Helvetica').fillColor('#9fb0c8')
       .text(limpiar(derechaAbajo), MARGEN, 53, unaLinea(8.5, { width: ancho, align: 'right' }));
  }
  doc.fillColor(AZUL);
  doc.y = 108;
}

// Salta de página si lo que viene no cabe en lo que queda
function asegurarEspacio(doc, alto) {
  if (doc.y + alto > doc.page.height - 60) {
    doc.addPage();
    return true;
  }
  return false;
}

function seccion(doc, titulo, contador = null) {
  asegurarEspacio(doc, 70);
  const texto = contador == null ? titulo : `${titulo}  (${contador})`;
  doc.fontSize(12.5).font('Helvetica-Bold').fillColor(AZUL)
     .text(limpiar(texto), MARGEN, doc.y);
  doc.moveTo(MARGEN, doc.y + 3).lineTo(doc.page.width - MARGEN, doc.y + 3)
     .strokeColor(AZUL).lineWidth(1.2).stroke();
  doc.moveDown(0.9);
}

// Texto corrido que puede ocupar varias líneas y saltar de página solo
function parrafo(doc, texto, { tam = 9.5, color = '#111827', sangria = 0 } = {}) {
  const ancho = doc.page.width - MARGEN * 2 - sangria;
  doc.fontSize(tam).font('Helvetica').fillColor(color);
  const alto = doc.heightOfString(limpiar(texto), { width: ancho });
  asegurarEspacio(doc, Math.min(alto, 120));
  doc.text(limpiar(texto), MARGEN + sangria, doc.y, { width: ancho });
}

function etiqueta(doc, texto, sangria = 0) {
  doc.fontSize(7).font('Helvetica-Bold').fillColor(GRIS)
     .text(limpiar(texto).toUpperCase(), MARGEN + sangria, doc.y,
           unaLinea(7, { width: doc.page.width - MARGEN * 2 - sangria, characterSpacing: 0.5 }));
  doc.moveDown(0.15);
}

// ─── Tablas ──────────────────────────────────────────────────────────
// La primera columna se alinea a la izquierda y el resto a la derecha,
// que es como se leen bien los números.
function tabla(doc, { cabeceras, proporciones, filas, sangria = 0, alto = 16 }) {
  const ancho  = doc.page.width - MARGEN * 2 - sangria;
  const x0     = MARGEN + sangria;
  const anchos = proporciones.map(p => ancho * p);

  const pintarCabecera = () => {
    const y = doc.y;
    doc.rect(x0, y, ancho, alto).fill('#f3f4f6');
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(AZUL);
    let x = x0;
    cabeceras.forEach((c, i) => {
      doc.text(limpiar(c), x + 5, y + 4.5,
        unaLinea(7.5, { width: anchos[i] - 10, align: i === 0 ? 'left' : 'right' }));
      x += anchos[i];
    });
    doc.y = y + alto;
  };

  asegurarEspacio(doc, alto * 3);
  pintarCabecera();
  doc.font('Helvetica').fontSize(8.5);

  filas.forEach((fila, idx) => {
    // Al saltar, la cabecera se repite para que la tabla se siga entendiendo
    if (doc.y + alto > doc.page.height - 60) {
      doc.addPage();
      pintarCabecera();
      doc.font('Helvetica').fontSize(8.5);
    }
    const y = doc.y;
    if (idx % 2 === 1) doc.rect(x0, y, ancho, alto).fill('#fafafa');
    doc.fillColor('#111827');
    let x = x0;
    fila.forEach((celda, i) => {
      doc.text(limpiar(celda), x + 5, y + 4.5,
        unaLinea(8.5, { width: anchos[i] - 10, align: i === 0 ? 'left' : 'right' }));
      x += anchos[i];
    });
    doc.y = y + alto;
  });

  doc.moveTo(x0, doc.y).lineTo(x0 + ancho, doc.y)
     .strokeColor(LINEA).lineWidth(0.5).stroke();
  doc.moveDown(0.4);
}

// ─── Tarjetas de indicadores ─────────────────────────────────────────
// items: [{ etiqueta, valor, nota?, color?, colorNota? }]
//   color     — tiñe el número grande (se usa para destacar un total)
//   colorNota — tiñe solo la línea de abajo (verde/rojo de la variación)
// Van separados a propósito: en el reporte, el número tiene que leerse
// siempre igual y lo que cambia de color es el "+12%" de abajo.
function tarjetas(doc, items, { columnas = 2, altoTarjeta = 40 } = {}) {
  const ancho    = doc.page.width - MARGEN * 2;
  const hueco    = 10;
  const colAncho = (ancho - hueco * (columnas - 1)) / columnas;
  const filas    = Math.ceil(items.length / columnas);

  asegurarEspacio(doc, filas * (altoTarjeta + 6));
  const yBase = doc.y;

  items.forEach((it, i) => {
    const col = i % columnas;
    const fil = Math.floor(i / columnas);
    const x = MARGEN + col * (colAncho + hueco);
    const y = yBase + fil * (altoTarjeta + 6);

    doc.roundedRect(x, y, colAncho, altoTarjeta, 5).fillAndStroke(SUAVE, LINEA);
    doc.fontSize(7).font('Helvetica-Bold').fillColor(GRIS)
       .text(limpiar(it.etiqueta).toUpperCase(), x + 9, y + 7,
             unaLinea(7, { width: colAncho - 18 }));
    doc.fontSize(13).font('Helvetica-Bold').fillColor(it.color || AZUL)
       .text(limpiar(it.valor), x + 9, y + 19, unaLinea(13, { width: colAncho - 18 }));
    if (it.nota) {
      doc.fontSize(7).font(it.colorNota ? 'Helvetica-Bold' : 'Helvetica')
         .fillColor(it.colorNota || GRIS)
         .text(limpiar(it.nota), x + 9, y + 32, unaLinea(7, { width: colAncho - 18 }));
    }
  });

  doc.y = yBase + filas * (altoTarjeta + 6) + 6;
}

// ─── Pie de página ───────────────────────────────────────────────────
// Se llama al final, cuando ya se sabe el total de páginas.
function pieDePagina(doc, { izquierda = '' } = {}) {
  const ancho   = doc.page.width - MARGEN * 2;
  const paginas = doc.bufferedPageRange();

  for (let i = 0; i < paginas.count; i++) {
    doc.switchToPage(paginas.start + i);
    const yPie = doc.page.height - 34;

    // El pie va por DEBAJO del margen inferior. pdfkit salta a una página
    // nueva en cuanto un texto empieza pasado ese margen —aunque lleve
    // lineBreak:false—, así que lo anulamos mientras dibujamos y lo dejamos
    // como estaba. Sin esto sale una página en blanco por cada línea del pie.
    const margenAbajo = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    try {
    doc.moveTo(MARGEN, yPie - 8).lineTo(doc.page.width - MARGEN, yPie - 8)
       .strokeColor(LINEA).lineWidth(0.5).stroke();
    doc.fontSize(7.5).fillColor(GRIS).font('Helvetica')
       .text(limpiar(izquierda), MARGEN, yPie, unaLinea(7.5, { width: ancho * 0.7 }))
       .text(`Página ${i + 1} de ${paginas.count}`,
             MARGEN + ancho * 0.7, yPie, unaLinea(7.5, { width: ancho * 0.3, align: 'right' }));

    } finally {
      // Siempre se restaura: si quedara en 0, el resto del documento
      // escribiría encima del pie.
      doc.page.margins.bottom = margenAbajo;
    }
  }
}

module.exports = {
  MARGEN, COLORES, unaLinea, CRC, fechaCorta, fechaLarga, limpiar,
  crearDocumento, encabezado, asegurarEspacio, seccion, parrafo, etiqueta,
  tabla, tarjetas, pieDePagina,
};

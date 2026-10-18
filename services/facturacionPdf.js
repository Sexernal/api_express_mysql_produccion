// services/facturacionPdf.js
//
// Dos PDF de facturación, generados en el servidor:
//   · lista   — todas las comandas que cumplen el filtro en pantalla
//   · comanda — el ticket de una sola consulta, el que se le da al cliente
//
// Se generan aquí y no con window.print() ni window.open() porque esos
// dependen del navegador: en algunos entornos no hay vista previa y no se
// puede saber cuántas páginas salen ni elegir cuál imprimir.
const {
  MARGEN, COLORES, CRC, fechaCorta, limpiar, unaLinea,
  crearDocumento, encabezado, asegurarEspacio, seccion, parrafo, etiqueta,
  tabla, tarjetas, pieDePagina,
} = require('./pdfBase');

const { AZUL, GRIS, LINEA, VERDE, AMBAR } = COLORES;

const TIPO_FICHA = {
  consulta: 'Consulta general', vacunacion: 'Vacunación', cirugia: 'Cirugía',
  urgencia: 'Urgencia', control: 'Control / revisión',
  desparasitacion: 'Desparasitación', otro: 'Otro',
};

const tipoDe = (r) =>
  (r.tipo === 'otro' && r.tipo_personalizado)
    ? r.tipo_personalizado
    : (TIPO_FICHA[r.tipo] || r.tipo || '—');

// La fecha viene como DATETIME; para el listado basta el día
const soloFecha = (val) => {
  if (!val) return '—';
  if (val instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${p(val.getDate())}/${p(val.getMonth() + 1)}/${val.getFullYear()}`;
  }
  return fechaCorta(String(val).slice(0, 10));
};

// Describe el filtro aplicado, para que el papel diga qué está mostrando
function describirFiltro({ q, cobrado, fecha_desde, fecha_hasta } = {}) {
  const partes = [];
  if (fecha_desde || fecha_hasta) {
    partes.push(`Del ${fecha_desde ? fechaCorta(fecha_desde) : 'inicio'} al ${fecha_hasta ? fechaCorta(fecha_hasta) : 'hoy'}`);
  }
  if (cobrado === '1') partes.push('Solo cobradas');
  if (cobrado === '0') partes.push('Solo pendientes');
  if (q) partes.push(`Búsqueda: "${q}"`);
  return partes.length ? partes.join('  ·  ') : 'Todas las comandas';
}

// ─── PDF 1: lista de comandas ────────────────────────────────────────

function generarFacturacionPDF({ datos, resumen, meta, filtros }, { clinica = 'Veterinaria Cañas', generadoPor = '', generadoEl = '' } = {}) {
  const { doc, listo, ancho } = crearDocumento();

  encabezado(doc, {
    titulo: clinica,
    subtitulo: 'Reporte de facturación',
    derechaAbajo: generadoPor ? `Responsable: ${generadoPor}` : '',
  });

  // Qué filtro está aplicado: sin esto el papel no se puede interpretar
  doc.fontSize(9).font('Helvetica-Bold').fillColor(AZUL)
     .text(limpiar(describirFiltro(filtros)), MARGEN, doc.y, unaLinea(9, { width: ancho }));

  // La pantalla muestra una página; el documento trae todo lo que cumple el
  // filtro. Sin decirlo, los totales del papel no cuadran con los de la
  // pantalla y no hay forma de saber cuál de los dos es el bueno.
  doc.moveDown(0.25);
  doc.fontSize(8).font('Helvetica').fillColor(GRIS)
     .text(limpiar(`Incluye las ${datos.length} comandas que cumplen el filtro`
         + `${meta?.total != null && meta.total !== datos.length ? ` (de ${meta.total} en total)` : ''}`
         + `, no solo la página que se ve en pantalla.`),
           MARGEN, doc.y, { width: ancho });
  doc.moveDown(1);

  tarjetas(doc, [
    { etiqueta: 'Pendiente de cobro', valor: CRC(resumen.pendiente), color: AMBAR,
      nota: `${resumen.n_pendientes} comanda${resumen.n_pendientes === 1 ? '' : 's'}` },
    { etiqueta: 'Cobrado',            valor: CRC(resumen.cobrado), color: VERDE,
      nota: `${resumen.n_cobradas} comanda${resumen.n_cobradas === 1 ? '' : 's'}` },
    { etiqueta: 'Total del periodo',  valor: CRC(resumen.total) },
    { etiqueta: 'Comandas listadas',  valor: String(resumen.comandas) },
  ], { columnas: 2 });

  if (meta?.truncado) {
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor(AMBAR)
       .text(limpiar(`Atención: hay ${meta.total} comandas que cumplen el filtro, `
           + `pero este documento muestra las ${meta.tope} más recientes. `
           + `Acotá el rango de fechas para verlas todas.`),
             MARGEN, doc.y, { width: ancho });
    doc.moveDown(1);
  }

  seccion(doc, 'Detalle de comandas', datos.length);

  if (!datos.length) {
    doc.fontSize(9).font('Helvetica-Oblique').fillColor(GRIS)
       .text('No hay comandas que cumplan el filtro seleccionado.', MARGEN + 4, doc.y,
             { width: ancho - 8 });
  } else {
    tabla(doc, {
      cabeceras: ['Fecha  ·  Paciente  ·  Propietario', 'Tipo', 'Items', 'Total', 'Estado'],
      proporciones: [0.40, 0.19, 0.08, 0.17, 0.16],
      filas: datos.map(r => [
        `${soloFecha(r.fecha)}  ·  ${r.mascota_nombre || '—'}  ·  ${r.propietario_nombre || '—'}`,
        tipoDe(r),
        String(r.items_count ?? (r.items || []).length),
        CRC(r.total_comanda),
        Number(r.cobrado) ? 'Cobrado' : 'Pendiente',
      ]),
    });

    // Línea de totales al cierre de la tabla
    doc.moveDown(0.3);
    doc.fontSize(10).font('Helvetica-Bold').fillColor(AZUL)
       .text(`TOTAL LISTADO:  ${CRC(resumen.total)}`, MARGEN, doc.y,
             unaLinea(10, { width: ancho, align: 'right' }));
  }

  pieDePagina(doc, {
    izquierda: `Facturación${generadoEl ? ` · generado el ${generadoEl}` : ''}${generadoPor ? ` · ${generadoPor}` : ''}`,
  });

  doc.end();
  return listo;
}

// ─── PDF 2: ticket de una comanda ────────────────────────────────────
// Es el comprobante que se le entrega al cliente, así que lleva el desglose
// completo y el total destacado.

function generarComandaPDF(c, { clinica = 'Veterinaria Cañas', generadoEl = '' } = {}) {
  const { doc, listo, ancho } = crearDocumento();

  encabezado(doc, {
    titulo: clinica,
    subtitulo: 'Comanda de servicio',
    derechaArriba: soloFecha(c.fecha),
    derechaAbajo: c.cobrado ? 'COBRADO' : 'PENDIENTE DE COBRO',
  });

  // ── Datos de la consulta ──
  seccion(doc, 'Datos de la consulta');
  tabla(doc, {
    cabeceras: ['Concepto', 'Detalle'],
    proporciones: [0.32, 0.68],
    filas: [
      ['Paciente',     [c.mascota_nombre, c.especie, c.raza].filter(Boolean).join(' · ') || '—'],
      ['Propietario',  [c.propietario_nombre, c.propietario_cedula].filter(Boolean).join(' · ') || '—'],
      ['Teléfono',     c.propietario_telefono || '—'],
      ['Fecha',        soloFecha(c.fecha)],
      ['Tipo de consulta', tipoDe(c)],
      ['Veterinario',  c.veterinario_nombre ? `Dr. ${c.veterinario_nombre}` : '—'],
    ],
  });
  doc.moveDown(0.6);

  // ── Desglose ──
  seccion(doc, 'Servicios y productos', c.items.length);
  if (!c.items.length) {
    doc.fontSize(9).font('Helvetica-Oblique').fillColor(GRIS)
       .text('Esta comanda no tiene ítems registrados.', MARGEN + 4, doc.y, { width: ancho - 8 });
  } else {
    tabla(doc, {
      cabeceras: ['Descripción', 'Cant.', 'Precio unit.', 'Subtotal'],
      proporciones: [0.46, 0.12, 0.21, 0.21],
      filas: c.items.map(i => [
        i.descripcion + (i.tipo === 'manual' ? '  (manual)' : ''),
        String(i.cantidad),
        CRC(i.precio_unitario),
        CRC(i.subtotal),
      ]),
    });

    // Total destacado
    asegurarEspacio(doc, 40);
    const y = doc.y + 4;
    doc.rect(MARGEN + ancho * 0.5, y, ancho * 0.5, 26).fillAndStroke('#f3f4f6', LINEA);
    doc.fontSize(9).font('Helvetica-Bold').fillColor(GRIS)
       .text('TOTAL', MARGEN + ancho * 0.5 + 10, y + 9, unaLinea(9, { width: 60 }));
    doc.fontSize(14).font('Helvetica-Bold').fillColor(AZUL)
       .text(CRC(c.total), MARGEN + ancho * 0.5 + 10, y + 6,
             unaLinea(14, { width: ancho * 0.5 - 20, align: 'right' }));
    doc.y = y + 34;
  }

  // ── Estado de cobro ──
  if (c.cobrado) {
    doc.moveDown(0.4);
    doc.fontSize(9).font('Helvetica-Bold').fillColor(VERDE)
       .text(limpiar(`Cobrado${c.cobrado_at ? ` el ${soloFecha(c.cobrado_at)}` : ''}`),
             MARGEN, doc.y, unaLinea(9, { width: ancho }));
    if (c.notas_cobro) {
      doc.moveDown(0.2);
      parrafo(doc, `Nota de cobro: ${c.notas_cobro}`, { tam: 8.5, color: GRIS });
    }
  }

  if (c.nota) {
    doc.moveDown(0.6);
    etiqueta(doc, 'Observaciones de la consulta');
    parrafo(doc, c.nota, { tam: 8.5 });
  }

  pieDePagina(doc, {
    izquierda: `Comanda #${c.id}${generadoEl ? ` · generada el ${generadoEl}` : ''}`,
  });

  doc.end();
  return listo;
}

module.exports = { generarFacturacionPDF, generarComandaPDF };

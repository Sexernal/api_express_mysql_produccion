// services/consolidadoPdf.js
//
// PDF del consolidado diario, generado en el servidor con pdfkit.
//
// Reemplaza al window.print() del navegador. La diferencia que importa: esto
// produce un archivo que se abre en un visor de PDF, donde SÍ se ve cuántas
// páginas son y se puede elegir cuál imprimir. El diálogo del navegador
// depende de cada entorno y en algunos no muestra vista previa.
const {
  MARGEN, COLORES, CRC, fechaCorta, fechaLarga, limpiar, unaLinea,
  crearDocumento, encabezado, asegurarEspacio, seccion, parrafo, etiqueta,
  tabla, tarjetas, pieDePagina,
} = require('./pdfBase');
const { esPersonalClinico } = require('./permisos');

const { AZUL, GRIS, LINEA, SUAVE, VERDE, AMBAR } = COLORES;

const ESTADO_CITA = {
  pendiente:  'Pendiente',
  confirmada: 'Confirmada',
  completada: 'Completada',
  cancelada:  'Cancelada',
};

const TIPO_FICHA = {
  consulta: 'Consulta general', vacunacion: 'Vacunación', cirugia: 'Cirugía',
  urgencia: 'Urgencia', control: 'Control / revisión',
  desparasitacion: 'Desparasitación', otro: 'Otro',
};

const tipoFicha = (f) =>
  (f.tipo === 'otro' && f.tipo_personalizado)
    ? f.tipo_personalizado
    : (TIPO_FICHA[f.tipo] || f.tipo || 'Registro');

const unir = (...partes) => partes.filter(Boolean).join(' · ');

// "Dr. Fulano" solo para quien atiende pacientes. Una ficha vieja puede venir
// firmada por recepción, y ahí el título estaría de más.
//
// ⚠️ La pantalla (app/consolidado/page.js en el frontend) usa esta misma regla.
// Si se cambia acá, hay que cambiarla allá o el papel y la pantalla dirán
// cosas distintas del mismo dato.
const conTitulo = (nombre, role) =>
  !nombre ? '—' : (esPersonalClinico(role) ? `Dr. ${nombre}` : nombre);

// ─── Bloque de un registro ───────────────────────────────────────────
// Cada ficha, vacuna o cita se dibuja como un recuadro con su número,
// un título y una rejilla de datos. Se mide antes de dibujar para no
// partir el recuadro entre dos páginas.
function registro(doc, { n, titulo, extra, datos, bloques = [] }) {
  const ancho = doc.page.width - MARGEN * 2;

  // Alto aproximado: cabecera + filas de la rejilla + los bloques de texto
  const filasDatos = Math.ceil(datos.length / 2);
  let alto = 24 + filasDatos * 13 + 10;
  for (const b of bloques) {
    doc.fontSize(9).font('Helvetica');
    alto += 16 + (b.texto ? doc.heightOfString(limpiar(b.texto), { width: ancho - 28 }) : 0);
    if (b.filas) alto += 18 + b.filas.length * 15;
  }
  // Un registro muy largo se parte igual; solo evitamos cortar los chicos
  asegurarEspacio(doc, Math.min(alto, 420));

  // Se guarda la página donde arranca: si el contenido salta a la siguiente,
  // el recuadro no se dibuja. Dibujarlo con las coordenadas viejas lo pondría
  // en la página equivocada, encerrando contenido que no le corresponde.
  const paginaIni = doc.page;
  const yIni = doc.y;
  doc.y = yIni + 9;

  // Título con el número de orden
  doc.fontSize(10).font('Helvetica-Bold').fillColor(AZUL)
     .text(`${n}.  ${limpiar(titulo)}`, MARGEN + 12, doc.y,
           unaLinea(10, { width: ancho - 24 - 150 }));
  if (extra) {
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor(extra.color || GRIS)
       .text(limpiar(extra.texto), MARGEN + ancho - 162, doc.y - 11,
             unaLinea(8.5, { width: 150, align: 'right' }));
  }
  doc.moveDown(0.5);

  // Rejilla de datos en dos columnas
  const colAncho = (ancho - 32) / 2;
  let y = doc.y;
  datos.forEach((d, i) => {
    const col = i % 2;
    if (col === 0 && i > 0) y += 13;
    const x = MARGEN + 14 + col * (colAncho + 4);
    doc.fontSize(7).font('Helvetica-Bold').fillColor(GRIS)
       .text(limpiar(d.label).toUpperCase(), x, y, unaLinea(7, { width: 72 }));
    doc.fontSize(8.5).font('Helvetica').fillColor('#111827')
       .text(limpiar(d.valor ?? '—') || '—', x + 74, y - 0.5,
             unaLinea(8.5, { width: colAncho - 78 }));
  });
  doc.y = y + 17;

  // Bloques: texto libre (observaciones, notas, motivo) o tabla de ítems
  for (const b of bloques) {
    if (b.texto) {
      etiqueta(doc, b.titulo, 14);
      parrafo(doc, b.texto, { tam: 8.5, sangria: 14 });
      doc.moveDown(0.4);
    } else if (b.filas && b.filas.length) {
      etiqueta(doc, b.titulo, 14);
      tabla(doc, {
        cabeceras: b.cabeceras,
        proporciones: b.proporciones,
        filas: b.filas,
        sangria: 14,
        alto: 14,
      });
    }
  }

  // El recuadro se dibuja al final, cuando ya se sabe dónde terminó.
  // Si el contenido saltó de página, se omite: un borde a medias confunde
  // más que la ausencia de borde.
  const yFin = doc.y;
  if (doc.page === paginaIni && yFin > yIni) {
    doc.roundedRect(MARGEN, yIni, ancho, yFin - yIni + 4, 4)
       .strokeColor(LINEA).lineWidth(0.7).stroke();
  }
  doc.y = yFin + 12;
}

function vacio(doc, texto) {
  doc.fontSize(9).font('Helvetica-Oblique').fillColor(GRIS)
     .text(limpiar(texto), MARGEN + 4, doc.y, { width: doc.page.width - MARGEN * 2 - 8 });
  doc.moveDown(1);
}

// ─── Firma final ─────────────────────────────────────────────────────
function firmas(doc, fecha) {
  asegurarEspacio(doc, 110);
  doc.moveDown(2);
  const ancho = doc.page.width - MARGEN * 2;
  const col   = (ancho - 50) / 2;
  const y     = doc.y + 26;

  [0, 1].forEach(i => {
    const x = MARGEN + i * (col + 50);
    doc.moveTo(x, y).lineTo(x + col, y).strokeColor('#000000').lineWidth(0.8).stroke();
    doc.fontSize(8.5).font('Helvetica').fillColor('#333333')
       .text(i === 0 ? 'Firma del médico veterinario' : 'Código de colegiado',
             x, y + 6, unaLinea(8.5, { width: col, align: 'center' }));
  });

  doc.y = y + 28;
  doc.fontSize(7.5).font('Helvetica').fillColor(GRIS)
     .text(`Documento generado automáticamente por el Sistema Veterinaria Cañas · ${fechaLarga(fecha)}`,
           MARGEN, doc.y, { width: ancho, align: 'center' });
}

/**
 * Devuelve un Buffer con el consolidado del día ya armado.
 * @param {object} c       lo que devuelve construirConsolidado()
 * @param {object} opciones { clinica, generadoPor, generadoEl }
 */
function generarConsolidadoPDF(c, { clinica = 'Veterinaria Cañas', generadoPor = '', generadoEl = '' } = {}) {
  const { doc, listo } = crearDocumento();

  encabezado(doc, {
    titulo: clinica,
    subtitulo: 'Consolidado de trabajos realizados',
    derechaArriba: fechaLarga(c.fecha),
    derechaAbajo: generadoPor ? `Responsable: ${generadoPor}` : '',
  });

  // ── Resumen del día ──
  const r = c.resumen;
  tarjetas(doc, [
    { etiqueta: 'Fichas médicas',      valor: String(r.fichas) },
    { etiqueta: 'Vacunas aplicadas',   valor: String(r.vacunas) },
    { etiqueta: 'Citas del día',       valor: String(r.citas), nota: `${r.citas_completadas} completadas` },
    { etiqueta: 'Pacientes atendidos', valor: String(r.pacientes_atendidos) },
    { etiqueta: 'Total facturado',     valor: CRC(r.total_facturado), color: VERDE },
  ], { columnas: 2 });

  // ── 1. Fichas médicas ──
  seccion(doc, 'Fichas médicas y procedimientos', c.fichas.length);
  if (!c.fichas.length) {
    vacio(doc, 'No se registraron fichas médicas en esta fecha.');
  } else {
    c.fichas.forEach((f, i) => {
      const registradoPor = conTitulo(f.registrado_por_nombre, f.registrado_por_role);

      registro(doc, {
        n: i + 1,
        titulo: `${f.mascota.nombre || '—'} — ${tipoFicha(f)}`,
        extra: f.total > 0
          ? { texto: `${f.cobrado ? 'Cobrado' : 'Pendiente'} · ${CRC(f.total)}`,
              color: f.cobrado ? VERDE : AMBAR }
          : { texto: f.hora, color: GRIS },
        datos: [
          { label: 'Hora',       valor: f.hora },
          { label: 'Paciente',   valor: unir(f.mascota.nombre, [f.mascota.especie, f.mascota.raza].filter(Boolean).join(' / '), f.mascota.edad) },
          // Nombre y cédula van en celdas separadas: juntos no caben en media
          // columna y la cédula —que es el dato que identifica al dueño en el
          // informe del Colegio— quedaba recortada.
          { label: 'Propietario', valor: f.propietario.nombre },
          { label: 'Cédula',     valor: f.propietario.cedula },
          { label: 'Teléfono',   valor: f.propietario.telefono },
          { label: 'Peso',       valor: f.peso != null ? `${f.peso} kg` : '—' },
          { label: 'Temperatura', valor: f.temperatura != null ? `${f.temperatura} °C` : '—' },
          { label: 'Registró',   valor: registradoPor },
        ],
        bloques: [
          ...(f.nota ? [{ titulo: 'Observaciones / diagnóstico', texto: f.nota }] : []),
          ...(f.items.length ? [{
            titulo: 'Tratamientos y servicios',
            cabeceras: ['Descripción', 'Cant.', 'Subtotal'],
            proporciones: [0.6, 0.15, 0.25],
            filas: f.items.map(it => [it.descripcion, String(it.cantidad), CRC(it.subtotal)]),
          }] : []),
        ],
      });
    });
  }

  // ── 2. Vacunas ──
  seccion(doc, 'Vacunas aplicadas', c.vacunas.length);
  if (!c.vacunas.length) {
    vacio(doc, 'No se aplicaron vacunas en esta fecha.');
  } else {
    c.vacunas.forEach((v, i) => {
      registro(doc, {
        n: i + 1,
        titulo: `${v.mascota.nombre || '—'} — ${v.nombre_vacuna || 'Vacuna'}`,
        extra: v.fecha_proxima ? { texto: `Próxima: ${v.fecha_proxima_display}`, color: GRIS } : null,
        datos: [
          { label: 'Paciente',    valor: unir(v.mascota.nombre, [v.mascota.especie, v.mascota.raza].filter(Boolean).join(' / ')) },
          { label: 'Propietario', valor: v.propietario.nombre },
          { label: 'Cédula',      valor: v.propietario.cedula },
          { label: 'Teléfono',    valor: v.propietario.telefono },
          { label: 'Producto',    valor: v.producto },
          { label: 'Lote',        valor: v.lote },
          { label: 'Veterinario', valor: v.veterinario_nombre ? `Dr. ${v.veterinario_nombre}` : '—' },
        ],
        bloques: v.notas ? [{ titulo: 'Notas', texto: v.notas }] : [],
      });
    });
  }

  // ── 3. Citas ──
  seccion(doc, 'Citas agendadas', c.citas.length);
  if (!c.citas.length) {
    vacio(doc, 'No hubo citas agendadas en esta fecha.');
  } else {
    c.citas.forEach((ci, i) => {
      registro(doc, {
        n: i + 1,
        titulo: `${ci.hora} — ${ci.mascota.nombre || '—'}`,
        extra: { texto: ESTADO_CITA[ci.estado] || ci.estado || '—', color: GRIS },
        datos: [
          { label: 'Paciente',    valor: unir(ci.mascota.nombre, [ci.mascota.especie, ci.mascota.raza].filter(Boolean).join(' / ')) },
          { label: 'Propietario', valor: ci.propietario.nombre },
          { label: 'Cédula',      valor: ci.propietario.cedula },
          { label: 'Teléfono',    valor: ci.propietario.telefono },
          { label: 'Consulta',    valor: ci.tipo_consulta },
          { label: 'Duración',    valor: ci.duracion_min ? `${ci.duracion_min} min` : '—' },
          { label: 'Veterinario', valor: ci.veterinario_nombre ? `Dr. ${ci.veterinario_nombre}` : '—' },
          ...(ci.origen === 'mobile' ? [{ label: 'Origen', valor: 'App móvil' }] : []),
        ],
        bloques: ci.motivo ? [{ titulo: 'Motivo', texto: ci.motivo }] : [],
      });
    });
  }

  firmas(doc, c.fecha);

  pieDePagina(doc, {
    izquierda: `Consolidado del ${fechaCorta(c.fecha)}`
             + (generadoEl ? ` · generado el ${generadoEl}` : '')
             + (generadoPor ? ` · ${generadoPor}` : ''),
  });

  doc.end();
  return listo;
}

module.exports = { generarConsolidadoPDF };

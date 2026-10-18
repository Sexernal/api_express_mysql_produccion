// controllers/consolidadoController.js
// Consolidado diario de trabajos realizados (informe para el Colegio de
// Veterinarios): fichas médicas con su comanda, vacunas aplicadas y citas.
//
// Dos salidas sobre los mismos datos: JSON para la pantalla y PDF para
// descargar. Las dos piden el consolidado a consolidadoService, así que
// no pueden desincronizarse.
const { isValidYMD, construirConsolidado } = require('../services/consolidadoService');
const { generarConsolidadoPDF } = require('../services/consolidadoPdf');

// Fecha y hora local del servidor, para el "generado el" del documento.
// No se usa toISOString porque en UTC-6 daría el día siguiente de noche.
function ahoraLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const ConsolidadoController = {

  // GET /consolidado?fecha=YYYY-MM-DD
  async porFecha(req, res) {
    try {
      const fecha = req.query.fecha;
      if (!isValidYMD(fecha)) {
        return res.status(400).json({ success: false, message: 'Parámetro fecha inválido (formato YYYY-MM-DD)' });
      }
      res.json({ success: true, data: await construirConsolidado(fecha) });
    } catch (err) {
      console.error('Error en consolidado:', err);
      res.status(500).json({ success: false, message: 'Error al generar el consolidado', error: err.message });
    }
  },

  // GET /consolidado/pdf?fecha=YYYY-MM-DD  → descarga
  //
  // Se genera en el servidor en vez de usar window.print() del navegador:
  // así el resultado es un archivo que se abre en un visor de PDF, donde se
  // ve cuántas páginas son y se puede elegir cuál imprimir. El diálogo del
  // navegador depende del entorno y en algunos no muestra vista previa.
  async pdf(req, res) {
    try {
      const fecha = req.query.fecha;
      if (!isValidYMD(fecha)) {
        return res.status(400).json({ success: false, message: 'Parámetro fecha inválido (formato YYYY-MM-DD)' });
      }

      const datos  = await construirConsolidado(fecha);
      const buffer = await generarConsolidadoPDF(datos, {
        generadoPor: req.user?.nombre || req.user?.email || '',
        generadoEl:  ahoraLocal(),
      });

      // attachment (no inline): el navegador lo baja en vez de abrirlo dentro
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="consolidado-${fecha}.pdf"`);
      res.setHeader('Content-Length', buffer.length);
      res.send(buffer);
    } catch (err) {
      console.error('Error en consolidado/pdf:', err);
      res.status(500).json({ success: false, message: 'Error al generar el PDF del consolidado', error: err.message });
    }
  },
};

module.exports = ConsolidadoController;

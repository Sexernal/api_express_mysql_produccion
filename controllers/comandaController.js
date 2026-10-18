// controllers/comandaController.js
const db = require('../db');
const {
  construirFacturacion, comandaDeFicha, resumirTotales,
} = require('../services/facturacionService');
const { generarFacturacionPDF, generarComandaPDF } = require('../services/facturacionPdf');

// Fecha y hora local del servidor para el "generado el" de los documentos.
// No se usa toISOString porque en UTC-6 daria el dia siguiente de noche.
function ahoraLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const ComandaController = {

  // GET /fichas/:fichaId/comanda
  async getByFicha(req, res) {
    try {
      const { fichaId } = req.params;
      const [items] = await db.query(
        'SELECT * FROM comanda_items WHERE ficha_id = ? ORDER BY id', [fichaId]
      );
      const [cobro] = await db.query(
        'SELECT * FROM fichas_cobro WHERE ficha_id = ?', [fichaId]
      );
      const total = items.reduce((s, i) => s + Number(i.cantidad) * Number(i.precio_unitario), 0);
      res.json({
        success: true,
        data: {
          items,
          total,
          cobrado:    cobro[0]?.cobrado    ?? 0,
          cobrado_at: cobro[0]?.cobrado_at ?? null,
          notas:      cobro[0]?.notas      ?? null,
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Error al obtener comanda', error: err.message });
    }
  },

  // PUT /fichas/:fichaId/comanda  — reemplaza todos los ítems
  async saveComanda(req, res) {
    try {
      const { fichaId } = req.params;
      const items = Array.isArray(req.body.items) ? req.body.items : [];

      const [ficha] = await db.query('SELECT id FROM fichas_medicas WHERE id = ?', [fichaId]);
      if (!ficha.length) return res.status(404).json({ success: false, message: 'Ficha no encontrada' });

      await db.query('DELETE FROM comanda_items WHERE ficha_id = ?', [fichaId]);

      for (const item of items) {
        if (!item.descripcion?.trim()) continue;
        const cantidad = Math.max(0.01, Number(item.cantidad) || 1);
        const precio   = Math.max(0, Number(item.precio_unitario) || 0);
        await db.query(
          'INSERT INTO comanda_items (ficha_id, tipo, servicio_id, descripcion, cantidad, precio_unitario) VALUES (?, ?, ?, ?, ?, ?)',
          [fichaId, item.tipo || 'manual', item.servicio_id || null, item.descripcion.trim(), cantidad, precio]
        );
      }

      const [saved] = await db.query('SELECT * FROM comanda_items WHERE ficha_id = ? ORDER BY id', [fichaId]);
      const total   = saved.reduce((s, i) => s + Number(i.cantidad) * Number(i.precio_unitario), 0);
      res.json({ success: true, data: { items: saved, total } });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Error al guardar comanda', error: err.message });
    }
  },

  // GET /facturacion
  async listFacturacion(req, res) {
    try {
      const { datos, meta } = await construirFacturacion(req.query);
      res.json({ success: true, data: datos, meta });
    } catch (err) {
      console.error('Error listFacturacion:', err);
      res.status(500).json({ success: false, message: 'Error al obtener facturación', error: err.message });
    }
  },

  // GET /facturacion/pdf?q=&cobrado=&fecha_desde=&fecha_hasta=  → descarga
  // Trae TODAS las comandas del filtro, no solo la pagina en pantalla.
  async pdfFacturacion(req, res) {
    try {
      const { datos, meta } = await construirFacturacion(req.query, { todos: true });
      const buffer = await generarFacturacionPDF(
        { datos, meta, resumen: resumirTotales(datos), filtros: req.query },
        { generadoPor: req.user?.nombre || req.user?.email || '', generadoEl: ahoraLocal() }
      );

      const sufijo = [req.query.fecha_desde, req.query.fecha_hasta].filter(Boolean).join('_a_');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition',
        `attachment; filename="facturacion${sufijo ? '-' + sufijo : ''}.pdf"`);
      res.setHeader('Content-Length', buffer.length);
      res.send(buffer);
    } catch (err) {
      console.error('Error pdfFacturacion:', err);
      res.status(500).json({ success: false, message: 'Error al generar el PDF de facturación', error: err.message });
    }
  },

  // GET /fichas/:fichaId/comanda/pdf  → descarga del ticket individual
  async pdfComanda(req, res) {
    try {
      const comanda = await comandaDeFicha(req.params.fichaId);
      if (!comanda) return res.status(404).json({ success: false, message: 'Comanda no encontrada' });

      const buffer = await generarComandaPDF(comanda, { generadoEl: ahoraLocal() });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="comanda-${comanda.id}.pdf"`);
      res.setHeader('Content-Length', buffer.length);
      res.send(buffer);
    } catch (err) {
      console.error('Error pdfComanda:', err);
      res.status(500).json({ success: false, message: 'Error al generar el PDF de la comanda', error: err.message });
    }
  },


  // PUT /facturacion/:fichaId/cobrar
  async marcarCobrado(req, res) {
    try {
      const { fichaId } = req.params;
      const cobrado = req.body.cobrado !== false && req.body.cobrado !== 0;
      const notas   = req.body.notas || null;
      const userId  = req.user?.userId || req.user?.id || null;

      const [ficha] = await db.query('SELECT id FROM fichas_medicas WHERE id = ?', [fichaId]);
      if (!ficha.length) return res.status(404).json({ success: false, message: 'Ficha no encontrada' });

      await db.query(
        `INSERT INTO fichas_cobro (ficha_id, cobrado, cobrado_at, cobrado_por, notas)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           cobrado     = VALUES(cobrado),
           cobrado_at  = VALUES(cobrado_at),
           cobrado_por = VALUES(cobrado_por),
           notas       = VALUES(notas)`,
        [fichaId, cobrado ? 1 : 0, cobrado ? new Date() : null, cobrado ? userId : null, notas]
      );

      res.json({ success: true, data: { ficha_id: Number(fichaId), cobrado, notas } });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Error al actualizar cobro', error: err.message });
    }
  },
};

module.exports = ComandaController;
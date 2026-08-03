// controllers/consolidadoController.js
// Consolidado diario de trabajos realizados (informe para el Colegio de Veterinarios).
// Devuelve, para una fecha dada: fichas médicas (con su comanda), vacunas aplicadas y citas.
const db = require('../db');

// mysql2 devuelve DATE/DATETIME como objetos Date; estos helpers aceptan ambos formatos
function toYMD(val) {
  if (!val) return null;
  if (val instanceof Date) {
    const pad = n => String(n).padStart(2, '0');
    return `${val.getFullYear()}-${pad(val.getMonth() + 1)}-${pad(val.getDate())}`;
  }
  const m = String(val).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function displayYMD(val) {
  const ymd = toYMD(val);
  if (!ymd) return '—';
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

function displayHora(val) {
  if (!val) return '—';
  const d = val instanceof Date ? val : new Date(String(val).replace(' ', 'T'));
  if (isNaN(d.getTime())) return '—';
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Valida por reconstrucción: '2026-02-31' pasaría el regex pero no es una fecha real
function isValidYMD(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const ConsolidadoController = {

  // GET /consolidado?fecha=YYYY-MM-DD
  async porFecha(req, res) {
    try {
      const fecha = req.query.fecha;
      if (!isValidYMD(fecha)) {
        return res.status(400).json({ success: false, message: 'Parámetro fecha inválido (formato YYYY-MM-DD)' });
      }

      // ── Fichas médicas del día ──────────────────────────────────────────────
      const [fichas] = await db.query(
        `SELECT f.id, f.tipo, f.tipo_personalizado, f.fecha, f.peso, f.temperatura,
                f.nota, f.filepath,
                m.id AS mascota_id, m.nombre AS mascota_nombre, m.especie, m.raza,
                m.fecha_nacimiento,
                p.id AS propietario_id, p.nombre AS propietario_nombre,
                p.cedula AS propietario_cedula, p.telefono AS propietario_telefono,
                u.nombre AS registrado_por_nombre, u.role AS registrado_por_role,
                COALESCE(fc.cobrado, 0) AS cobrado
         FROM fichas_medicas f
         LEFT JOIN mascotas m       ON f.mascota_id = m.id
         LEFT JOIN propietarios p   ON m.owner_id   = p.id
         LEFT JOIN usuarios u       ON f.uploaded_by = u.id
         LEFT JOIN fichas_cobro fc  ON fc.ficha_id  = f.id
         WHERE f.fecha >= ? AND f.fecha < DATE_ADD(?, INTERVAL 1 DAY)
         ORDER BY f.fecha ASC, f.id ASC`,
        [fecha, fecha]
      );

      // Ítems de comanda (tratamientos/servicios cobrados) de esas fichas
      let itemsByFicha = {};
      if (fichas.length) {
        const ids = fichas.map(f => f.id);
        const [items] = await db.query(
          `SELECT ficha_id, tipo, descripcion, cantidad, precio_unitario
           FROM comanda_items
           WHERE ficha_id IN (${ids.map(() => '?').join(',')})
           ORDER BY ficha_id, id`,
          ids
        );
        for (const it of items) {
          if (!itemsByFicha[it.ficha_id]) itemsByFicha[it.ficha_id] = [];
          itemsByFicha[it.ficha_id].push({
            tipo: it.tipo,
            descripcion: it.descripcion,
            cantidad: Number(it.cantidad),
            precio_unitario: Number(it.precio_unitario),
            subtotal: Number(it.cantidad) * Number(it.precio_unitario),
          });
        }
      }

      // ── Vacunas aplicadas el día ────────────────────────────────────────────
      const [vacunas] = await db.query(
        `SELECT v.id, v.nombre_vacuna, v.producto, v.lote,
                v.fecha_aplicacion, v.fecha_proxima, v.notas,
                m.id AS mascota_id, m.nombre AS mascota_nombre, m.especie, m.raza,
                p.id AS propietario_id, p.nombre AS propietario_nombre,
                p.cedula AS propietario_cedula, p.telefono AS propietario_telefono,
                u.nombre AS veterinario_nombre
         FROM vacunas v
         LEFT JOIN mascotas m     ON v.mascota_id     = m.id
         LEFT JOIN propietarios p ON m.owner_id       = p.id
         LEFT JOIN usuarios u     ON v.veterinario_id = u.id
         WHERE v.fecha_aplicacion = ?
         ORDER BY v.id ASC`,
        [fecha]
      );

      // ── Citas del día ───────────────────────────────────────────────────────
      const [citas] = await db.query(
        `SELECT c.id, c.fecha_inicio, c.duracion_min, c.tipo_consulta, c.motivo, c.estado, c.origen,
                m.nombre AS mascota_nombre, m.especie, m.raza,
                p.nombre AS propietario_nombre, p.cedula AS propietario_cedula,
                p.telefono AS propietario_telefono,
                u.nombre AS veterinario_nombre
         FROM citas c
         LEFT JOIN mascotas m     ON c.mascota_id     = m.id
         LEFT JOIN propietarios p ON c.propietario_id = p.id
         LEFT JOIN usuarios u     ON c.veterinario_id = u.id
         WHERE c.fecha_inicio >= ? AND c.fecha_inicio < DATE_ADD(?, INTERVAL 1 DAY)
         ORDER BY c.fecha_inicio ASC`,
        [fecha, fecha]
      );

      // ── Armado de la respuesta ──────────────────────────────────────────────
      const fichasOut = fichas.map(f => {
        const items = itemsByFicha[f.id] || [];
        return {
          id: f.id,
          tipo: f.tipo,
          tipo_personalizado: f.tipo_personalizado,
          tipo_display: (f.tipo === 'otro' && f.tipo_personalizado) ? f.tipo_personalizado : f.tipo,
          hora: displayHora(f.fecha),
          peso: f.peso != null ? Number(f.peso) : null,
          temperatura: f.temperatura != null ? Number(f.temperatura) : null,
          nota: f.nota,
          filepath: f.filepath,
          cobrado: Number(f.cobrado) === 1,
          mascota: {
            id: f.mascota_id, nombre: f.mascota_nombre,
            especie: f.especie, raza: f.raza,
            fecha_nacimiento: toYMD(f.fecha_nacimiento),
          },
          propietario: {
            id: f.propietario_id, nombre: f.propietario_nombre,
            cedula: f.propietario_cedula, telefono: f.propietario_telefono,
          },
          // uploaded_by es quien registró la ficha: puede ser recepcionista (role 'user'),
          // por eso se expone el role y el frontend solo antepone "Dr." si es admin.
          registrado_por_nombre: f.registrado_por_nombre,
          registrado_por_role: f.registrado_por_role,
          items,
          total: items.reduce((s, i) => s + i.subtotal, 0),
        };
      });

      const vacunasOut = vacunas.map(v => ({
        id: v.id,
        nombre_vacuna: v.nombre_vacuna,
        producto: v.producto,
        lote: v.lote,
        fecha_aplicacion_display: displayYMD(v.fecha_aplicacion),
        fecha_proxima: toYMD(v.fecha_proxima),
        fecha_proxima_display: v.fecha_proxima ? displayYMD(v.fecha_proxima) : '—',
        notas: v.notas,
        mascota: { id: v.mascota_id, nombre: v.mascota_nombre, especie: v.especie, raza: v.raza },
        propietario: {
          id: v.propietario_id, nombre: v.propietario_nombre,
          cedula: v.propietario_cedula, telefono: v.propietario_telefono,
        },
        veterinario_nombre: v.veterinario_nombre,
      }));

      const citasOut = citas.map(c => ({
        id: c.id,
        hora: displayHora(c.fecha_inicio),
        duracion_min: c.duracion_min,
        tipo_consulta: c.tipo_consulta,
        motivo: c.motivo,
        estado: (c.estado || '').toLowerCase(),
        origen: c.origen,
        mascota: { nombre: c.mascota_nombre, especie: c.especie, raza: c.raza },
        propietario: {
          nombre: c.propietario_nombre, cedula: c.propietario_cedula,
          telefono: c.propietario_telefono,
        },
        veterinario_nombre: c.veterinario_nombre,
      }));

      // Pacientes únicos atendidos (fichas + vacunas), para el encabezado del informe
      const pacientes = new Set();
      for (const f of fichasOut) if (f.mascota.id) pacientes.add(f.mascota.id);
      for (const v of vacunasOut) if (v.mascota.id) pacientes.add(v.mascota.id);

      res.json({
        success: true,
        data: {
          fecha,
          fecha_display: displayYMD(fecha),
          resumen: {
            fichas: fichasOut.length,
            vacunas: vacunasOut.length,
            citas: citasOut.length,
            citas_completadas: citasOut.filter(c => c.estado === 'completada').length,
            pacientes_atendidos: pacientes.size,
            total_facturado: fichasOut.reduce((s, f) => s + f.total, 0),
          },
          fichas: fichasOut,
          vacunas: vacunasOut,
          citas: citasOut,
        },
      });
    } catch (err) {
      console.error('Error en consolidado:', err);
      res.status(500).json({ success: false, message: 'Error al generar el consolidado', error: err.message });
    }
  },
};

module.exports = ConsolidadoController;
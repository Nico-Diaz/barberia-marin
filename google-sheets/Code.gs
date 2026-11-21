/**
 * API de la Barbería sobre Google Sheets (reemplaza a Supabase).
 *
 * INSTALACIÓN (ver MIGRACION.md para el paso a paso completo):
 *  1. Creá una hoja de cálculo nueva en Google Sheets.
 *  2. Menú Extensiones → Apps Script. Borrá lo que haya y pegá este archivo entero.
 *  3. Cambiá API_SECRET por una clave cualquiera (la misma que vas a poner en SHEETS_API_SECRET).
 *  4. Implementar → Nueva implementación → Tipo: Aplicación web
 *       - Ejecutar como: Yo
 *       - Quién tiene acceso: Cualquier usuario
 *     Copiá la URL que termina en /exec → esa es SHEETS_API_URL.
 *
 * Las pestañas (turnos, servicios, dias_especiales) se crean solas la primera vez.
 * Todos los valores se guardan como TEXTO para que Sheets no convierta fechas ni horas.
 */
const API_SECRET = 'cambia-esta-clave';

const TABLAS = {
  turnos: ['id', 'negocio_id', 'fecha', 'hora', 'servicio', 'profesional', 'cliente_nombre', 'cliente_apellido', 'cliente_telefono', 'estado', 'created_at'],
  servicios: ['id', 'negocio_id', 'nombre', 'precio'],
  dias_especiales: ['id', 'negocio_id', 'fecha', 'cerrado', 'motivo', 'hora_inicio', 'hora_fin'],
};

function doGet() {
  return responder({ ok: true, data: 'API de la barbería funcionando' });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return responder({ ok: false, error: 'JSON inválido' });
  }
  if (body.secret !== API_SECRET) return responder({ ok: false, error: 'Clave API incorrecta' });

  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    return responder({ ok: true, data: ejecutar(body) });
  } catch (err) {
    return responder({ ok: false, error: String((err && err.message) || err), code: err && err.code });
  } finally {
    lock.releaseLock();
  }
}

function ejecutar(body) {
  switch (body.action) {
    case 'getAll': {
      const tablas = body.tablas || Object.keys(TABLAS);
      const out = {};
      tablas.forEach(function (t) { out[t] = leer(t); });
      return out;
    }
    case 'list': return leer(body.tabla);
    case 'insert': return insertar(body.tabla, body.filas || [], body.unico);
    case 'update': return actualizar(body.tabla, body.id, body.valores || {});
    case 'delete': return borrar(body.tabla, body.id);
    case 'replaceAll': return reemplazar(body.tabla, body.filas || []);
    default: throw new Error('Acción desconocida: ' + body.action);
  }
}

// ---------- helpers de hoja ----------

function hoja(tabla) {
  if (!TABLAS[tabla]) throw new Error('Tabla desconocida: ' + tabla);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(tabla);
  if (!sh) sh = ss.insertSheet(tabla);
  if (sh.getLastRow() === 0) escribirEncabezados(sh, TABLAS[tabla]);
  return sh;
}

function escribirEncabezados(sh, cols) {
  const rng = sh.getRange(1, 1, 1, cols.length);
  rng.setNumberFormat('@');
  rng.setValues([cols]);
  rng.setFontWeight('bold');
  sh.setFrozenRows(1);
}

function encabezados(sh) {
  const n = sh.getLastColumn();
  if (n === 0) return [];
  return sh.getRange(1, 1, 1, n).getDisplayValues()[0].map(function (h) { return String(h).trim(); });
}

/** Agrega al final las columnas que falten y devuelve la lista completa. */
function asegurarColumnas(sh, claves) {
  const cols = encabezados(sh);
  const faltan = claves.filter(function (k, i) { return cols.indexOf(k) === -1 && claves.indexOf(k) === i; });
  if (faltan.length) {
    const rng = sh.getRange(1, cols.length + 1, 1, faltan.length);
    rng.setNumberFormat('@');
    rng.setValues([faltan]);
    rng.setFontWeight('bold');
    return cols.concat(faltan);
  }
  return cols;
}

function valorCelda(v) {
  if (v === null || v === undefined) return '';
  if (v === true) return 'TRUE';
  if (v === false) return 'FALSE';
  return String(v);
}

function leer(tabla) {
  const sh = hoja(tabla);
  const cols = encabezados(sh);
  const filas = sh.getLastRow() - 1;
  if (filas < 1 || cols.length === 0) return [];
  const valores = sh.getRange(2, 1, filas, cols.length).getDisplayValues();
  return valores
    .filter(function (fila) { return fila.some(function (c) { return String(c) !== ''; }); })
    .map(function (fila) {
      const obj = {};
      cols.forEach(function (c, i) { if (c) obj[c] = fila[i]; });
      return obj;
    });
}

function siguienteId(filas) {
  let max = 0;
  filas.forEach(function (f) {
    const n = Number(f.id);
    if (f.id !== '' && isFinite(n) && n > max) max = n;
  });
  return Math.floor(max) + 1;
}

function escribirFilas(sh, cols, filas, desde) {
  if (!filas.length) return;
  const matriz = filas.map(function (f) { return cols.map(function (c) { return valorCelda(f[c]); }); });
  const rng = sh.getRange(desde, 1, matriz.length, cols.length);
  rng.setNumberFormat('@');
  rng.setValues(matriz);
}

function buscarFila(sh, cols, id) {
  const idCol = cols.indexOf('id');
  const n = sh.getLastRow() - 1;
  if (idCol === -1 || n < 1) return -1;
  const ids = sh.getRange(2, idCol + 1, n, 1).getDisplayValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

// ---------- operaciones ----------

function insertar(tabla, filas, unico) {
  const sh = hoja(tabla);
  let claves = ['id'];
  filas.forEach(function (f) { claves = claves.concat(Object.keys(f)); });
  const cols = asegurarColumnas(sh, claves);
  const existentes = leer(tabla);

  if (unico && unico.length) {
    filas.forEach(function (f) {
      const choca = existentes.some(function (r) {
        return unico.every(function (c) { return valorCelda(r[c]) === valorCelda(f[c]); });
      });
      if (choca) {
        const err = new Error('Registro duplicado');
        err.code = 'DUPLICADO';
        throw err;
      }
    });
  }

  let next = siguienteId(existentes);
  const ahora = new Date().toISOString();
  const nuevas = filas.map(function (f) {
    const copia = {};
    Object.keys(f).forEach(function (k) { copia[k] = f[k]; });
    if (copia.id === undefined || copia.id === null || copia.id === '') copia.id = String(next++);
    if (cols.indexOf('created_at') !== -1 && !copia.created_at) copia.created_at = ahora;
    return copia;
  });
  escribirFilas(sh, cols, nuevas, sh.getLastRow() + 1);
  return nuevas;
}

function actualizar(tabla, id, valores) {
  const sh = hoja(tabla);
  const cols = asegurarColumnas(sh, Object.keys(valores));
  const nroFila = buscarFila(sh, cols, id);
  if (nroFila === -1) throw new Error('No existe el registro ' + id + ' en ' + tabla);
  const rng = sh.getRange(nroFila, 1, 1, cols.length);
  const actual = rng.getDisplayValues()[0];
  const obj = {};
  cols.forEach(function (c, i) { obj[c] = actual[i]; });
  Object.keys(valores).forEach(function (k) { if (k !== 'id') obj[k] = valores[k]; });
  escribirFilas(sh, cols, [obj], nroFila);
  return obj;
}

function borrar(tabla, id) {
  const sh = hoja(tabla);
  const cols = encabezados(sh);
  const nroFila = buscarFila(sh, cols, id);
  if (nroFila !== -1) sh.deleteRow(nroFila);
  return { id: id, borrado: nroFila !== -1 };
}

/** Usado por el script de migración: borra la pestaña y la reescribe completa. */
function reemplazar(tabla, filas) {
  const sh = hoja(tabla);
  sh.clear();
  let cols = TABLAS[tabla].slice();
  filas.forEach(function (f) {
    Object.keys(f).forEach(function (k) { if (cols.indexOf(k) === -1) cols.push(k); });
  });
  escribirEncabezados(sh, cols);
  escribirFilas(sh, cols, filas, 2);
  return { tabla: tabla, filas: filas.length };
}

function responder(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

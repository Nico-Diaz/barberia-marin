// Copia todos los datos de Supabase a la hoja de Google Sheets.
//
// Uso (desde la raíz del proyecto, con las variables en .env):
//   node scripts/migrar-supabase.mjs                 → descarga backup + copia a la hoja
//   node scripts/migrar-supabase.mjs --solo-backup   → solo descarga el backup JSON
//   node scripts/migrar-supabase.mjs --sobrescribir  → copia aunque la hoja ya tenga datos
//   node scripts/migrar-supabase.mjs --todos         → no filtra por PUBLIC_NEGOCIO_ID
//
// Variables necesarias:
//   PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY   (las de siempre)
//   SHEETS_API_URL, SHEETS_API_SECRET               (las nuevas)
//   PUBLIC_NEGOCIO_ID                               (opcional, para filtrar)
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

const args = new Set(process.argv.slice(2));
const env = process.env;
const SUPABASE_URL = (env.PUBLIC_SUPABASE_URL || env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_KEY;
const NEGOCIO = args.has('--todos') ? '' : env.PUBLIC_NEGOCIO_ID || '';
const TABLAS = ['servicios', 'dias_especiales', 'turnos'];

// Corta la ejecución con un mensaje (sin process.exit, que en Windows puede crashear justo después de un fetch)
class Salida extends Error {}
function salir(msg) {
    throw new Salida(msg);
}

async function leerSupabase(tabla) {
    const filas = [];
    const paso = 1000;
    for (let desde = 0; ; desde += paso) {
        const url = new URL(`${SUPABASE_URL}/rest/v1/${tabla}`);
        url.searchParams.set('select', '*');
        url.searchParams.set('order', 'id.asc');
        url.searchParams.set('limit', String(paso));
        url.searchParams.set('offset', String(desde));
        if (NEGOCIO) url.searchParams.set('negocio_id', `eq.${NEGOCIO}`);
        const res = await fetch(url, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
        if (!res.ok) salir(`Supabase respondió ${res.status} al leer "${tabla}": ${await res.text()}`);
        const lote = await res.json();
        filas.push(...lote);
        if (lote.length < paso) return filas;
    }
}

async function sheets(action, payload = {}) {
    const res = await fetch(env.SHEETS_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ secret: env.SHEETS_API_SECRET, action, ...payload }),
        redirect: 'follow',
    });
    const texto = await res.text();
    let json;
    try { json = JSON.parse(texto); } catch { salir(`Respuesta inválida de Google Sheets (HTTP ${res.status}).`); }
    if (!json.ok) salir(`Google Sheets: ${json.error}`);
    return json.data;
}

// Supabase devuelve horas como "11:00:00": las dejamos como "11:00" (igual que el formulario)
const hhmm = (v) => {
    const m = String(v ?? '').match(/^(\d{1,2}):(\d{2})/);
    return m ? `${m[1].padStart(2, '0')}:${m[2]}` : v;
};
function normalizar(tabla, fila) {
    const out = { ...fila };
    for (const c of ['hora', 'hora_inicio', 'hora_fin']) if (out[c]) out[c] = hhmm(out[c]);
    if (tabla === 'dias_especiales') out.cerrado = out.cerrado === true || out.cerrado === 'true';
    for (const [k, v] of Object.entries(out)) {
        if (v !== null && typeof v === 'object') out[k] = JSON.stringify(v);
    }
    return out;
}

async function main() {
    if (!SUPABASE_URL || !SUPABASE_KEY) salir('Faltan PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY.');
    if (!args.has('--solo-backup') && !env.SHEETS_API_URL) salir('Falta SHEETS_API_URL (o usá --solo-backup).');

    console.log(`📥 Leyendo Supabase${NEGOCIO ? ` (negocio_id = ${NEGOCIO})` : ' (todos los negocios)'}...`);
    const datos = {};
    for (const t of TABLAS) {
        datos[t] = (await leerSupabase(t)).map((f) => normalizar(t, f));
        console.log(`   ${t}: ${datos[t].length} filas`);
    }

    mkdirSync('migracion-backup', { recursive: true });
    const archivo = `migracion-backup/supabase-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    writeFileSync(archivo, JSON.stringify(datos, null, 2));
    console.log(`💾 Backup guardado en ${archivo}`);

    if (args.has('--solo-backup')) return;

    console.log('🔎 Revisando la hoja de Google Sheets...');
    const actual = await sheets('getAll');
    const conDatos = TABLAS.filter((t) => (actual[t] || []).length > 0);
    if (conDatos.length && !args.has('--sobrescribir')) {
        salir(`La hoja ya tiene datos en: ${conDatos.join(', ')}. Si querés reemplazarlos, corré de nuevo con --sobrescribir.`);
    }

    for (const t of TABLAS) {
        const r = await sheets('replaceAll', { tabla: t, filas: datos[t] });
        console.log(`📤 ${t}: ${r.filas} filas copiadas`);
    }

    const control = await sheets('getAll');
    const errores = TABLAS.filter((t) => (control[t] || []).length !== datos[t].length);
    if (errores.length) salir(`Las cantidades no coinciden en: ${errores.join(', ')}`);
    console.log('\n✅ Migración completa. Ya podés probar la página con la hoja.');
}

main().catch((e) => {
    console.error('\n❌ ' + (e instanceof Salida ? e.message : e?.stack || e));
    process.exitCode = 1;
});

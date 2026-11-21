// Cliente de la "base de datos" en Google Sheets (reemplaza a Supabase).
// Habla con el Apps Script de google-sheets/Code.gs publicado como aplicación web.

export type Tabla = 'turnos' | 'servicios' | 'dias_especiales';

export interface Turno {
    id: string;
    negocio_id: string;
    fecha: string;          // AAAA-MM-DD
    hora: string;           // HH:MM
    servicio: string;
    profesional: string;
    cliente_nombre: string;
    cliente_apellido: string;
    cliente_telefono: string | null;
    estado: string;
}

export interface Servicio {
    id: string;
    negocio_id: string;
    nombre: string;
    precio: number;
}

export interface DiaEspecial {
    id: string;
    negocio_id: string;
    fecha: string;
    cerrado: boolean;
    motivo: string;
    hora_inicio: string | null;
    hora_fin: string | null;
}

export interface Datos {
    turnos: Turno[];
    servicios: Servicio[];
    dias_especiales: DiaEspecial[];
}

export class SheetsError extends Error {
    code?: string;
    constructor(message: string, code?: string) {
        super(message);
        this.code = code;
    }
}

const API_URL = import.meta.env.SHEETS_API_URL ?? process.env.SHEETS_API_URL;
const API_SECRET = import.meta.env.SHEETS_API_SECRET ?? process.env.SHEETS_API_SECRET;

async function llamar<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
    if (!API_URL) throw new SheetsError('Falta la variable SHEETS_API_URL');
    const res = await fetch(API_URL, {
        method: 'POST',
        // text/plain evita el "preflight" y es lo que mejor recibe Apps Script
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ secret: API_SECRET, action, ...payload }),
        redirect: 'follow',
    });
    const texto = await res.text();
    let json: any;
    try {
        json = JSON.parse(texto);
    } catch {
        throw new SheetsError(`Respuesta inválida de Google Sheets (HTTP ${res.status}). ¿La implementación tiene acceso "Cualquier usuario"?`);
    }
    if (!json.ok) throw new SheetsError(json.error || 'Error en Google Sheets', json.code);
    return json.data as T;
}

// ---------- normalización (en la hoja todo es texto) ----------

const hhmm = (v: unknown): string => {
    const s = String(v ?? '').trim();
    const m = s.match(/^(\d{1,2}):(\d{2})/);
    return m ? `${m[1].padStart(2, '0')}:${m[2]}` : s;
};
const horaONull = (v: unknown) => (String(v ?? '').trim() ? hhmm(v) : null);
const texto = (v: unknown) => String(v ?? '').trim();
const textoONull = (v: unknown) => texto(v) || null;
const booleano = (v: unknown) => ['true', 'verdadero', '1', 'si', 'sí'].includes(texto(v).toLowerCase());

const aTurno = (r: any): Turno => ({
    id: texto(r.id),
    negocio_id: texto(r.negocio_id),
    fecha: texto(r.fecha),
    hora: hhmm(r.hora),
    servicio: texto(r.servicio),
    profesional: texto(r.profesional),
    cliente_nombre: texto(r.cliente_nombre),
    cliente_apellido: texto(r.cliente_apellido),
    cliente_telefono: textoONull(r.cliente_telefono),
    estado: texto(r.estado),
});

const aServicio = (r: any): Servicio => ({
    id: texto(r.id),
    negocio_id: texto(r.negocio_id),
    nombre: texto(r.nombre),
    precio: Number(texto(r.precio).replace(',', '.')) || 0,
});

const aDia = (r: any): DiaEspecial => ({
    id: texto(r.id),
    negocio_id: texto(r.negocio_id),
    fecha: texto(r.fecha),
    cerrado: booleano(r.cerrado),
    motivo: texto(r.motivo),
    hora_inicio: horaONull(r.hora_inicio),
    hora_fin: horaONull(r.hora_fin),
});

// ---------- API pública ----------

/** Trae las tres tablas en una sola llamada, ya ordenadas. */
export async function obtenerDatos(): Promise<Datos> {
    const raw = await llamar<Record<Tabla, any[]>>('getAll');
    const turnos = (raw.turnos || []).map(aTurno).filter(t => t.fecha)
        .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora));
    const servicios = (raw.servicios || []).map(aServicio).filter(s => s.nombre)
        .sort((a, b) => a.precio - b.precio);
    const dias_especiales = (raw.dias_especiales || []).map(aDia).filter(d => d.fecha)
        .sort((a, b) => a.fecha.localeCompare(b.fecha));
    return { turnos, servicios, dias_especiales };
}

/** Inserta una fila. Con `unico` falla con code "DUPLICADO" si ya existe una fila con esos mismos valores. */
export async function insertar(tabla: Tabla, fila: Record<string, unknown>, opciones: { unico?: string[] } = {}) {
    const [nueva] = await llamar<Record<string, string>[]>('insert', { tabla, filas: [fila], unico: opciones.unico });
    return nueva;
}

export async function actualizar(tabla: Tabla, id: string, valores: Record<string, unknown>) {
    return llamar<Record<string, string>>('update', { tabla, id, valores });
}

export async function borrar(tabla: Tabla, id: string) {
    return llamar<{ id: string; borrado: boolean }>('delete', { tabla, id });
}

export { hhmm as normalizarHora };

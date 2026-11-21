// Login del panel admin (reemplaza a Supabase Auth).
// El usuario y la contraseña se definen en las variables ADMIN_EMAIL y ADMIN_PASSWORD.
// La sesión es una cookie firmada con HMAC, válida por una semana.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AstroCookies } from 'astro';

const COOKIE = 'admin-session';
const DURACION_MS = 7 * 24 * 60 * 60 * 1000;

const ADMIN_EMAIL = import.meta.env.ADMIN_EMAIL ?? process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = import.meta.env.ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD;
const SESSION_SECRET = import.meta.env.SESSION_SECRET ?? process.env.SESSION_SECRET;

const secreto = () => SESSION_SECRET || `${ADMIN_EMAIL}:${ADMIN_PASSWORD}`;
const firmar = (datos: string) => createHmac('sha256', secreto()).update(datos).digest('base64url');

function iguales(a: string, b: string) {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function credencialesValidas(email: string, password: string) {
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return false;
    return iguales(email.trim().toLowerCase(), ADMIN_EMAIL.trim().toLowerCase()) && iguales(password, ADMIN_PASSWORD);
}

export function iniciarSesion(cookies: AstroCookies) {
    const datos = Buffer.from(JSON.stringify({ e: ADMIN_EMAIL, exp: Date.now() + DURACION_MS })).toString('base64url');
    cookies.set(COOKIE, `${datos}.${firmar(datos)}`, {
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: DURACION_MS / 1000,
    });
}

export function sesionValida(cookies: AstroCookies) {
    const valor = cookies.get(COOKIE)?.value;
    if (!valor || !ADMIN_EMAIL || !ADMIN_PASSWORD) return false;
    const [datos, firma] = valor.split('.');
    if (!datos || !firma || !iguales(firma, firmar(datos))) return false;
    try {
        const { exp } = JSON.parse(Buffer.from(datos, 'base64url').toString());
        return typeof exp === 'number' && exp > Date.now();
    } catch {
        return false;
    }
}

export function cerrarSesion(cookies: AstroCookies) {
    cookies.delete(COOKIE, { path: '/' });
}

# Migración de Supabase a Google Sheets

La página ya no usa Supabase. Los datos viven en una hoja de Google Sheets con tres pestañas:

| Pestaña           | Qué guarda                                                   |
| ----------------- | ------------------------------------------------------------ |
| `turnos`          | Reservas de clientes y descansos (`cliente_nombre = DESCANSO`) |
| `servicios`       | Servicios y precios                                          |
| `dias_especiales` | Días cerrados y horarios especiales                          |

Podés abrir la hoja y editar cualquier celda a mano. Para tener una copia en Excel: **Archivo → Descargar → Microsoft Excel (.xlsx)**.

> **¿Por qué Google Sheets y no un archivo .xlsx?** La página corre en Vercel, y Vercel no puede guardar cambios en un archivo dentro del proyecto: cada reserva se perdería. Google Sheets es una planilla online que la página puede leer y modificar, y se abre como Excel cuando quieras.

El login del panel `/admin` también dejó de depender de Supabase: ahora usa el email y la contraseña que definas en `ADMIN_EMAIL` y `ADMIN_PASSWORD`.

---

## 1. Crear la hoja y su API (5 minutos)

1. Entrá a <https://sheets.new> con tu cuenta de Google y ponele un nombre (ej. *Barbería Marin - Datos*).
2. Menú **Extensiones → Apps Script**.
3. Borrá el código que aparece y pegá **todo** el contenido de [`google-sheets/Code.gs`](google-sheets/Code.gs).
4. En la línea `const API_SECRET = 'cambia-esta-clave';` poné una clave inventada (ej. `barberia-2026-xyz`). Guardá (💾).
5. **Implementar → Nueva implementación**:
   - Tipo (⚙️): **Aplicación web**
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
6. Autorizá los permisos que pide Google. Si aparece "Google no verificó esta app": **Configuración avanzada → Ir a … (no seguro)**. Es tu propio script.
7. Copiá la **URL de la aplicación web** (termina en `/exec`).

Las pestañas se crean solas la primera vez que la página o el script de migración usan la hoja.

> Si más adelante cambiás `Code.gs`, tenés que publicar de nuevo: **Implementar → Gestionar implementaciones → ✏️ → Versión: Nueva versión → Implementar**. La URL no cambia.

## 2. Variables de entorno

En Vercel (**Settings → Environment Variables**) y en tu `.env` local (ver `.env.example`):

| Variable            | Valor                                       |
| ------------------- | ------------------------------------------- |
| `SHEETS_API_URL`    | La URL `/exec` del paso 1                   |
| `SHEETS_API_SECRET` | La misma clave que pusiste en `API_SECRET`  |
| `ADMIN_EMAIL`       | El email con el que entrás a `/admin`       |
| `ADMIN_PASSWORD`    | La contraseña para entrar a `/admin`        |
| `SESSION_SECRET`    | (Opcional) cualquier texto largo            |

`PUBLIC_NEGOCIO_ID`, `RESEND_API_KEY` y `RESEND_FROM` siguen igual.

## 3. Copiar los datos que ya están en Supabase

Con `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `SHEETS_API_URL` y `SHEETS_API_SECRET` en tu `.env`:

```powershell
node scripts/migrar-supabase.mjs
```

El script:

1. Descarga `servicios`, `dias_especiales` y `turnos` de Supabase (filtrando por `PUBLIC_NEGOCIO_ID` si está definido; `--todos` para no filtrar).
2. Guarda un backup en `migracion-backup/` (no se sube a git porque tiene teléfonos de clientes).
3. Copia todo a la hoja, conservando los `id` originales.
4. Verifica que las cantidades coincidan.

Si la hoja ya tiene datos, se frena. Usá `--sobrescribir` para reemplazarlos, o `--solo-backup` para solo descargar el JSON.

## 4. Publicar y liberar Supabase

1. Hacé deploy en Vercel con las variables nuevas.
2. Probá: reservar un turno, entrar a `/admin`, cambiar un precio, bloquear un día.
3. Cuando todo ande bien, podés borrar el proyecto en Supabase y las variables `PUBLIC_SUPABASE_*`.

---

## Qué cambió en el código

- `src/lib/sheets.ts`: cliente de la hoja (leer todo, insertar, actualizar, borrar). Reemplaza a `src/lib/supabase.ts`.
- `src/lib/auth.ts`: login con `ADMIN_EMAIL` / `ADMIN_PASSWORD` y cookie de sesión firmada. Reemplaza a Supabase Auth.
- `google-sheets/Code.gs`: la API que corre dentro de la hoja. Todas las escrituras pasan por un bloqueo, y al guardar un turno vuelve a verificar que fecha+hora no esté ocupada, así dos personas no pueden reservar el mismo horario al mismo tiempo.
- `scripts/migrar-supabase.mjs`: copia de datos de una sola vez.
- Las celdas se guardan como texto para que Sheets no convierta `2026-11-21` en fecha ni `11:00` en hora. Si editás a mano, escribí con el mismo formato (`AAAA-MM-DD`, `HH:MM`, `TRUE`/`FALSE` en `cerrado`).
- La página de reservas ya no envía los nombres de los clientes al navegador, solo fecha y hora de los turnos ocupados.

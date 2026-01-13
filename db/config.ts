import { defineDb, defineTable, column } from 'astro:db';

const Turnos = defineTable({
  columns: {
    id: column.number({ primaryKey: true }),
    nombre: column.text(),
    apellido: column.text(),
    telefono: column.text({ optional: true }),
    fecha: column.text(),
    hora: column.text(),
    estado: column.text({ default: 'pendiente' })
  }
});

// IMPORTANTE: Turnos debe estar aquí dentro para que se pueda importar después
export default defineDb({
  tables: { Turnos }
});
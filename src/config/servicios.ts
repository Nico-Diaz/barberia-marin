export const servicios = [
    { 
        id: 'corte', 
        nombre: 'Corte Clásico', 
        precio: 9000 
    },
    { 
        id: 'completo', 
        nombre: 'Corte + Barba', 
        precio: 11000 
    }
];

// Función helper para formatear precio (ej: $ 9.000)
export const formatearPrecio = (valor: number) => {
    return new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS',
        minimumFractionDigits: 0
    }).format(valor);
}
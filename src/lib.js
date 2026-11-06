export const $ = n => '$' + (Math.round((+n || 0) * 100) / 100).toLocaleString('es-MX')
export const iso = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
export const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d) }
export const weekStart = s => addDays(s, -new Date(s + 'T12:00:00').getDay())
export const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
export const fail = e => { if (e) alert(e.message); return !!e }
export const EMOJI = { Preparados: '🌶️', Comida: '🍽️', Botanas: '🥜', Bebidas: '🥤', Café: '☕', Cigarros: '🚬', Otros: '🛒' }
export const ORDEN = ['Preparados', 'Comida', 'Botanas', 'Bebidas', 'Café']
export const hora = t => new Date(t).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })

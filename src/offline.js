import { useEffect, useState } from 'react'
import { supabase } from './supabase'

/* Cola de ventas hechas sin internet. Se guarda en el equipo (localStorage) y se envía sola al volver la conexión. */
const KC = nid => 'av_cola_' + nid
const subs = new Set()

export const getCola = nid => { try { return JSON.parse(localStorage.getItem(KC(nid))) || [] } catch { return [] } }
const setCola = (nid, c) => {
  try { localStorage.setItem(KC(nid), JSON.stringify(c)) } catch { /* almacenamiento lleno */ }
  subs.forEach(f => f())
}
export const encolar = (nid, v) => setCola(nid, [...getCola(nid), v])
export const quitar = (nid, cid) => setCola(nid, getCola(nid).filter(v => v.cid !== cid))
export const marcar = (nid, cid, error) => setCola(nid, getCola(nid).map(v => (v.cid === cid ? { ...v, error } : v)))

export function useCola(nid) {
  const [c, setC] = useState(() => getCola(nid))
  useEffect(() => { const f = () => setC(getCola(nid)); subs.add(f); f(); return () => subs.delete(f) }, [nid])
  return c
}

export const nuevoId = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16) }))

export const pendientesPorProducto = cola => {
  const m = {}
  cola.forEach(v => v.items.forEach(i => { m[i.producto_id] = (m[i.producto_id] || 0) + i.cantidad }))
  return m
}

/* Copia del catálogo para poder abrir el POS sin internet */
export const cacheProds = {
  get(nid) { try { return JSON.parse(localStorage.getItem('av_prods_' + nid)) || [] } catch { return [] } },
  set(nid, rows) { try { localStorage.setItem('av_prods_' + nid, JSON.stringify(rows)) } catch { /* lleno */ } },
}

let syncing = false
/* Envía las ventas pendientes en orden. Con todo=true también reintenta las que dieron error. */
export async function sincronizar(nid, todo = false) {
  if (syncing) return { ok: 0, fallo: 0, ocupado: true }
  syncing = true
  let ok = 0, fallo = 0, sinRed = false
  try {
    const { data } = await supabase.auth.getSession()
    if (!data.session) return { ok, fallo, sinSesion: true }
    for (const v of getCola(nid)) {
      if (v.error && !todo) continue
      const { error, status } = await supabase.rpc('registrar_venta', {
        p_negocio: nid, p_items: v.items, p_metodo: v.metodo, p_descuento: v.descuento,
        p_pago_con: v.pago_con, p_nota: v.nota, p_id: v.cid, p_ts: v.ts,
      })
      if (!error || error.code === '23505') { quitar(nid, v.cid); ok++ }
      else if (status === 0) { sinRed = true; break }
      else { marcar(nid, v.cid, error.message); fallo++ }
    }
  } finally { syncing = false }
  return { ok, fallo, sinRed }
}

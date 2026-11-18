import { supabase } from './supabase'

const BUCKET = 'productos'

/* Reduce la foto (celular: 4000 px / 5 MB) a ~900 px y ~150 KB antes de subirla */
export async function comprimir(file, max = 900) {
  try {
    const bmp = await createImageBitmap(file)
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82))
    return blob || file
  } catch { return file }
}

export async function borrarFoto(url) {
  const m = String(url || '').match(new RegExp('/storage/v1/object/public/' + BUCKET + '/(.+)$'))
  if (!m) return
  try { await supabase.storage.from(BUCKET).remove([decodeURIComponent(m[1])]) } catch { /* ya no existía */ }
}

/* Sube la foto a la carpeta del negocio y regresa su enlace público. Borra la anterior. */
export async function subirFoto(nid, productoId, file, anterior, { sinComprimir = false } = {}) {
  const blob = sinComprimir ? file : await comprimir(file)
  const tipo = blob.type || file.type || 'image/jpeg'
  const path = `${nid}/${productoId}-${Date.now()}.${tipo === 'image/png' ? 'png' : tipo === 'image/webp' ? 'webp' : 'jpg'}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: tipo, cacheControl: '31536000' })
  if (error) throw error
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  await borrarFoto(anterior)
  return data.publicUrl
}

/* ---------- Mejorar con IA: quitar fondo → fondo blanco, centrado, luz y sombra suave ---------- */

/* Arma la foto final de 1000×1000 sobre fondo blanco a partir del recorte (PNG con transparencia). */
export function pintarBlanco(src, nuevo = () => document.createElement('canvas')) {
  const S = 1000
  const c = nuevo(); c.width = S; c.height = S
  const g = c.getContext('2d')
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S)

  // el producto cabe en 80% del ancho y 74% del alto, un poco arriba para dejar lugar a la sombra
  const k = Math.min(S * 0.8 / src.width, S * 0.74 / src.height, 1.6)
  const w = Math.max(1, Math.round(src.width * k)), h = Math.max(1, Math.round(src.height * k))
  const x = Math.round((S - w) / 2), y = Math.round((S - h) / 2 - S * 0.02)

  // mejora de color: estira luces y sombras (sin pasarse) y sube un poco la saturación
  const t = nuevo(); t.width = w; t.height = h
  const tg = t.getContext('2d'); tg.drawImage(src, 0, 0, w, h)
  const im = tg.getImageData(0, 0, w, h), d = im.data
  const hist = new Array(256).fill(0); let n = 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 200) { hist[Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])]++; n++ }
  }
  let lo = 0, hi = 255
  if (n) {
    let a = 0
    for (lo = 0; lo < 255 && a < n * 0.01; lo++) a += hist[lo]
    a = 0
    for (hi = 255; hi > 0 && a < n * 0.01; hi--) a += hist[hi]
  }
  lo = Math.min(lo, 50); hi = Math.max(hi, 205)
  const esc = 255 / (hi - lo), sat = 1.1
  const cl = v => Math.max(0, Math.min(255, v))
  for (let i = 0; i < d.length; i += 4) {
    let r = (d[i] - lo) * esc, gg = (d[i + 1] - lo) * esc, b = (d[i + 2] - lo) * esc
    const l = 0.299 * r + 0.587 * gg + 0.114 * b
    r = l + (r - l) * sat; gg = l + (gg - l) * sat; b = l + (b - l) * sat
    d[i] = cl(r); d[i + 1] = cl(gg); d[i + 2] = cl(b)
  }
  tg.putImageData(im, 0, 0)

  // sombra suave debajo del producto
  const rx = w * 0.42, ry = Math.max(14, h * 0.045)
  g.save(); g.translate(S / 2, y + h - 4); g.scale(1, ry / rx)
  const sh = g.createRadialGradient(0, 0, 0, 0, 0, rx)
  sh.addColorStop(0, 'rgba(0,0,0,0.30)'); sh.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = sh; g.beginPath(); g.arc(0, 0, rx, 0, Math.PI * 2); g.fill(); g.restore()

  g.drawImage(t, x, y)
  return c
}

const sinCache = u => u + (u.includes('?') ? '&' : '?') + 't=' + Date.now()

/* origen: la foto (File/Blob) o su enlace. Regresa un JPEG listo para subir. */
export async function mejorarConIA(nid, origen) {
  const orig = typeof origen === 'string' ? await (await fetch(sinCache(origen))).blob() : origen
  const peq = await comprimir(orig, 1200)
  const fd = new FormData()
  fd.append('imagen', peq, 'foto.jpg'); fd.append('negocio_id', nid)
  const { data, error } = await supabase.functions.invoke('mejorar-foto', { body: fd })
  if (error) {
    let msg = 'No se pudo mejorar la foto. Intenta de nuevo.'
    try { const j = await error.context.json(); if (j && j.error) msg = j.error } catch { /* sin detalle */ }
    throw new Error(msg)
  }
  const bmp = await createImageBitmap(data)
  const blob = await new Promise(r => pintarBlanco(bmp).toBlob(r, 'image/jpeg', 0.9))
  if (!blob) throw new Error('No se pudo preparar la foto.')
  return blob
}

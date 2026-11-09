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
export async function subirFoto(nid, productoId, file, anterior) {
  const blob = await comprimir(file)
  const tipo = blob.type || file.type || 'image/jpeg'
  const path = `${nid}/${productoId}-${Date.now()}.${tipo === 'image/png' ? 'png' : tipo === 'image/webp' ? 'webp' : 'jpg'}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: tipo, cacheControl: '31536000' })
  if (error) throw error
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  await borrarFoto(anterior)
  return data.publicUrl
}

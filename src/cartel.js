import QRCode from 'qrcode'

const img = src => new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = src })
const tel = d => String(d || '').replace(/^52(\d{2})(\d{4})(\d{4})$/, '+52 $1 $2 $3')

/* QR con corrección de errores alta (soporta el logo al centro) */
export const qrPng = (url, ancho = 1024) =>
  QRCode.toDataURL(url, { width: ancho, margin: 2, errorCorrectionLevel: 'H', color: { dark: '#111111', light: '#ffffff' } })

/* Cartel listo para imprimir o compartir por WhatsApp (1200×1700 px, proporción de hoja carta/A4) */
export async function cartelPng({ url, nombre = 'Antojitos Velázquez', whatsapp }) {
  try { await document.fonts?.load('800 80px Inter') } catch { /* usa la fuente del sistema */ }
  const W = 1200, H = 1700
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const g = c.getContext('2d')
  const F = (peso, px) => `${peso} ${px}px Inter, system-ui, -apple-system, 'Segoe UI', sans-serif`
  const centro = (txt, y, fuente, color) => { g.font = fuente; g.fillStyle = color; g.textAlign = 'center'; g.fillText(txt, W / 2, y) }
  const circulo = (im, cx, cy, r) => { g.save(); g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip(); g.drawImage(im, cx - r, cy - r, r * 2, r * 2); g.restore() }

  g.fillStyle = '#111111'; g.fillRect(0, 0, W, H)
  const glow = g.createRadialGradient(W * 0.85, 120, 40, W * 0.85, 120, 720)
  glow.addColorStop(0, 'rgba(255,183,3,0.30)'); glow.addColorStop(1, 'rgba(255,183,3,0)')
  g.fillStyle = glow; g.fillRect(0, 0, W, H)
  g.fillStyle = '#ffb703'; g.fillRect(0, 0, W, 26); g.fillRect(0, H - 26, W, 26)

  const logo = await img('/logo.jpg')
  circulo(logo, W / 2, 190, 120)
  centro('¡PIDE AQUÍ!', 440, F(800, 112), '#ffb703')
  centro('Escanea el código con la cámara de tu celular', 505, F(500, 38), '#f1eadc')

  g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect(180, 545, 840, 840, 48); g.fill()
  g.drawImage(await img(await qrPng(url, 720)), 240, 605, 720, 720)
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(W / 2, 965, 88, 0, Math.PI * 2); g.fill()
  circulo(logo, W / 2, 965, 76)

  centro(nombre, 1470, F(800, 62), '#ffffff')
  centro('A domicilio o para recoger', 1525, F(600, 40), '#ffb703')
  let host = ''
  try { host = new URL(url).host } catch { /* sin dominio */ }
  if (host) centro(host, 1590, F(600, 40), '#ffffff')
  if (whatsapp) centro('WhatsApp ' + tel(whatsapp), 1640, F(500, 34), '#cfc7b8')
  return c.toDataURL('image/png')
}

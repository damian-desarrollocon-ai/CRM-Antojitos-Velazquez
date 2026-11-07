import { useEffect, useState } from 'react'

const KEY = 'av_install_off'
// ya está dentro de la app instalada (TWA, PWA o acceso directo)
const esApp = () =>
  (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
  window.navigator.standalone === true ||
  document.referrer.startsWith('android-app://')

/* Invita a instalar la app. Prioridad: Google Play → APK directo → instalación del navegador → guía para iPhone. */
export default function InstallBanner({ playUrl, apkUrl }) {
  const [evt, setEvt] = useState(null)
  const [oculto, setOculto] = useState(() => { try { return Date.now() < +localStorage.getItem(KEY) } catch { return false } })
  const ua = navigator.userAgent
  const android = /Android/i.test(ua)
  const ios = /iPhone|iPad|iPod/i.test(ua)

  useEffect(() => {
    const f = e => { e.preventDefault(); setEvt(e) }
    window.addEventListener('beforeinstallprompt', f)
    return () => window.removeEventListener('beforeinstallprompt', f)
  }, [])

  const cerrar = () => {
    try { localStorage.setItem(KEY, String(Date.now() + 14 * 86400000)) } catch { /* sin almacenamiento */ }
    setOculto(true)
  }
  if (oculto || esApp()) return null

  let accion = null
  if (android && playUrl) accion = { txt: 'Descargar en Google Play', href: playUrl }
  else if (android && apkUrl) accion = { txt: 'Descargar la app', href: apkUrl }
  else if (evt) accion = { txt: 'Instalar app', onClick: async () => { evt.prompt(); await evt.userChoice; setEvt(null); cerrar() } }
  else if (ios) accion = { txt: 'Cómo instalar', onClick: () => alert('En Safari toca el botón Compartir y luego "Agregar a pantalla de inicio".') }
  if (!accion) return null

  return (
    <div className="st-install" role="region" aria-label="Instalar la app">
      <img src="/pwa-192.png" alt="" />
      <div><b>Pide más rápido con nuestra app</b><small>Tu pedido a un toque, sin buscar el enlace.</small></div>
      {accion.href
        ? <a className="go" href={accion.href} target="_blank" rel="noreferrer">{accion.txt}</a>
        : <button className="go" onClick={accion.onClick}>{accion.txt}</button>}
      <button className="no" onClick={cerrar} aria-label="Cerrar">✕</button>
    </div>
  )
}

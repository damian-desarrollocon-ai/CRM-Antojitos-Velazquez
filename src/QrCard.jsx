import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { fail } from './lib'
import { cartelPng, qrPng } from './cartel'

// Cada QR lleva una etiqueta (?o=) para saber de dónde llegan los pedidos.
const ORIGENES = [['qr', 'Mostrador'], ['ticket', 'Ticket o bolsa'], ['fb', 'Facebook / anuncios'], ['wa', 'WhatsApp']]

export default function QrCard({ nid, tienda }) {
  const [o, setO] = useState('qr')
  const [cartel, setCartel] = useState('')
  const [plano, setPlano] = useState('')
  const [stats, setStats] = useState(null)
  const url = window.location.origin + '/?o=' + o

  useEffect(() => {
    let vivo = true
    setCartel('')
    Promise.all([cartelPng({ url, nombre: tienda?.nombre, whatsapp: tienda?.whatsapp }), qrPng(url, 1024)])
      .then(([a, b]) => { if (vivo) { setCartel(a); setPlano(b) } })
      .catch(() => { if (vivo) setCartel('error') })
    return () => { vivo = false }
  }, [url, tienda?.nombre, tienda?.whatsapp])

  useEffect(() => {
    const desde = new Date(Date.now() - 30 * 86400000).toISOString()
    supabase.from('pedidos').select('origen').eq('negocio_id', nid).neq('estado', 'cancelado').gte('creado_at', desde)
      .then(({ data, error }) => {
        if (error) return
        const m = {}
        ;(data || []).forEach(p => { const k = p.origen || 'directo'; m[k] = (m[k] || 0) + 1 })
        setStats(m)
      })
  }, [nid])

  const imprimir = () => {
    document.body.classList.add('printing-qr')
    const fin = () => { document.body.classList.remove('printing-qr'); window.removeEventListener('afterprint', fin) }
    window.addEventListener('afterprint', fin)
    setTimeout(() => window.print(), 150)
  }
  const copiar = () => navigator.clipboard?.writeText(url).then(() => alert('Enlace copiado')).catch(e => fail(e))
  const nombreOrigen = k => (ORIGENES.find(x => x[0] === k) || [k, k === 'directo' ? 'Directo (sin etiqueta)' : k])[1]

  return (
    <div className="card">
      <b>Código QR para tus clientes</b>
      <p className="mu">Imprímelo y ponlo en el mostrador, o pégalo en la bolsa y el ticket. Al escanearlo, el cliente abre tu tienda y pide.
        Usa el dominio con el que abriste esta página; si cambias de dominio, vuelve a generarlo aquí.</p>
      <div className="chips">
        {ORIGENES.map(([k, t]) => <button key={k} className={o === k ? 'on' : ''} onClick={() => setO(k)}>{t}</button>)}
      </div>
      <input readOnly value={url} onFocus={e => e.target.select()} />
      <div className="qrprev">
        {cartel && cartel !== 'error' && <img src={cartel} alt="Cartel con código QR" />}
        {!cartel && <p className="mu">Generando…</p>}
        {cartel === 'error' && <p className="bad">No se pudo generar el cartel en este navegador.</p>}
      </div>
      {cartel && cartel !== 'error' && (
        <div className="acts">
          <button className="btn" onClick={imprimir}>🖨 Imprimir cartel</button>
          <a className="btn s" href={cartel} download={`cartel-qr-${o}.png`}>Descargar cartel</a>
          <a className="btn s" href={plano} download={`qr-${o}.png`}>Solo el QR</a>
          <button className="btn s" onClick={copiar}>Copiar enlace</button>
        </div>
      )}
      {cartel && cartel !== 'error' && <div className="qr-print"><img src={cartel} alt="" /></div>}

      {stats && (
        <>
          <h3>Pedidos de los últimos 30 días, por origen</h3>
          {Object.keys(stats).length === 0 && <p className="mu">Aún no hay pedidos.</p>}
          {Object.entries(stats).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
            <div className="row" key={k}><span>{nombreOrigen(k)}</span><b>{n}</b></div>
          ))}
        </>
      )}
    </div>
  )
}

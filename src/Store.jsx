import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { $, EMOJI, ORDEN } from './lib'
import './store.css'

const LS = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d } catch { return d } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* sin almacenamiento */ } },
}
const PASOS = ['nuevo', 'preparando', 'listo', 'entregado']
const etiqueta = (e, tipo) => ({
  nuevo: 'Pedido recibido', preparando: 'Preparando tu pedido',
  listo: tipo === 'domicilio' ? 'En camino' : 'Listo para recoger', entregado: 'Entregado', cancelado: 'Cancelado',
}[e] || e)
const iconos = { nuevo: '🧾', preparando: '👨‍🍳', listo: '🛵', entregado: '✅' }

function Stepper({ q, onChange }) {
  return (
    <span className="st-step">
      <button type="button" onClick={() => onChange(q - 1)} aria-label="Quitar uno">−</button>
      <b>{q}</b>
      <button type="button" onClick={() => onChange(q + 1)} aria-label="Agregar uno">+</button>
    </span>
  )
}

function Item({ p, q, onQty }) {
  return (
    <div className="st-item">
      <div className="st-info">
        <h4>{p.nombre}</h4>
        {p.descripcion && <p>{p.descripcion}</p>}
        <strong>{$(p.precio)}</strong>
      </div>
      <div className="st-pic">
        {p.imagen_url ? <img src={p.imagen_url} alt="" loading="lazy" /> : <span>{EMOJI[p.categoria] || '🛒'}</span>}
        {q ? <Stepper q={q} onChange={onQty} /> : <button className="st-add" onClick={() => onQty(1)} aria-label={'Agregar ' + p.nombre}>+</button>}
      </div>
    </div>
  )
}

function Modo({ tienda, tipo, setTipo }) {
  return (
    <div className="st-modo">
      {tienda.acepta_domicilio && (
        <button className={tipo === 'domicilio' ? 'on' : ''} onClick={() => setTipo('domicilio')}>
          <b>🛵 A domicilio</b><small>{+tienda.costo_envio ? 'Envío ' + $(tienda.costo_envio) : 'Envío gratis'}</small>
        </button>
      )}
      {tienda.acepta_recoger && (
        <button className={tipo === 'recoger' ? 'on' : ''} onClick={() => setTipo('recoger')}>
          <b>🏪 Recoger</b><small>Sin costo de envío</small>
        </button>
      )}
    </div>
  )
}

function Cart({ tienda, items, sub, envio, total, tipo, setQty, onNext, onClose }) {
  const falta = Math.max(0, (+tienda.pedido_minimo || 0) - sub)
  return (
    <div className="st-cart">
      <div className="st-cart-h"><h3>Tu pedido</h3>{onClose && <button onClick={onClose} aria-label="Cerrar">✕</button>}</div>
      {!items.length ? (
        <p className="st-empty">Aún no agregas productos.<br />Elige algo del menú 🌶️</p>
      ) : (
        <>
          {items.map(i => (
            <div className="st-line" key={i.id}>
              <Stepper q={i.q} onChange={n => setQty(i.id, n)} />
              <span>{i.nombre}</span>
              <b>{$(i.q * i.precio)}</b>
            </div>
          ))}
          <div className="st-sum">
            <div><span>Subtotal</span><span>{$(sub)}</span></div>
            {tipo === 'domicilio' && <div><span>Envío</span><span>{envio ? $(envio) : 'Gratis'}</span></div>}
            <div className="t"><span>Total</span><span>{$(total)}</span></div>
          </div>
          {falta > 0 && <p className="st-warn">Te faltan {$(falta)} para llegar al pedido mínimo.</p>}
          {!tienda.abierto && <p className="st-warn">Estamos cerrados por ahora.</p>}
          <button className="st-cta" disabled={falta > 0 || !tienda.abierto} onClick={onNext}>Continuar · {$(total)}</button>
        </>
      )}
    </div>
  )
}

function Top({ tienda, onHome }) {
  return (
    <header className="st-top">
      <button className="st-brand" onClick={onHome}>
        <img src="/logo.jpg" alt="Antojitos Velázquez" />
        <span>Antojitos <b>Velázquez</b></span>
      </button>
      {tienda?.whatsapp && (
        <a className="st-wa" href={'https://wa.me/' + tienda.whatsapp} target="_blank" rel="noreferrer">WhatsApp</a>
      )}
    </header>
  )
}

function Footer({ tienda }) {
  return (
    <footer className="st-foot">
      <b>{tienda.nombre}</b>
      {tienda.direccion && <p>📍 {tienda.direccion}</p>}
      {tienda.horario && <p>🕒 {tienda.horario}</p>}
      {tienda.zona && <p>🛵 Entregamos en: {tienda.zona}</p>}
      {tienda.whatsapp && <p>💬 <a href={'https://wa.me/' + tienda.whatsapp} target="_blank" rel="noreferrer">WhatsApp +{tienda.whatsapp}</a></p>}
    </footer>
  )
}

function Checkout({ tienda, items, sub, envio, total, tipo, setTipo, setQty, onBack, onDone }) {
  const [f, setF] = useState(() => ({ nombre: '', telefono: '', direccion: '', referencias: '', metodo: 'efectivo', pagaCon: '', notas: '', ...LS.get('av_cliente', {}) }))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setF({ ...f, [k]: v })

  const enviar = async e => {
    e.preventDefault(); setErr(''); setBusy(true)
    const { data, error } = await supabase.rpc('crear_pedido', {
      p_negocio: tienda.negocio_id, p_cliente: f.nombre, p_telefono: f.telefono, p_tipo: tipo,
      p_direccion: tipo === 'domicilio' ? f.direccion : null, p_referencias: tipo === 'domicilio' ? f.referencias : null,
      p_metodo: f.metodo, p_paga_con: f.metodo === 'efectivo' && f.pagaCon ? +f.pagaCon : null, p_notas: f.notas || null,
      p_items: items.map(i => ({ producto_id: i.id, cantidad: i.q })),
    })
    setBusy(false)
    if (error) return setErr(error.message)
    LS.set('av_cliente', { nombre: f.nombre, telefono: f.telefono, direccion: f.direccion, referencias: f.referencias })
    onDone(data.codigo)
  }

  const metodos = [['efectivo', '💵 Efectivo', 'Pagas al recibir'], ['transferencia', '📲 Transferencia', 'Te enviamos los datos por WhatsApp'], ['tarjeta', '💳 Tarjeta', 'Terminal al entregar']]

  return (
    <div className="st-co">
      <button className="st-back" onClick={onBack}>← Volver al menú</button>
      <form onSubmit={enviar} className="st-co-grid">
        <div className="st-box">
          <h2>Finalizar pedido</h2>
          <Modo tienda={tienda} tipo={tipo} setTipo={setTipo} />
          <label>Nombre</label>
          <input required minLength={2} maxLength={60} autoComplete="name" value={f.nombre} onChange={e => set('nombre', e.target.value)} />
          <label>Teléfono / WhatsApp</label>
          <input required type="tel" inputMode="tel" autoComplete="tel" placeholder="10 dígitos" value={f.telefono} onChange={e => set('telefono', e.target.value)} />
          {tipo === 'domicilio' && (
            <>
              <label>Dirección de entrega</label>
              <input required minLength={6} maxLength={200} autoComplete="street-address" placeholder="Calle, número, colonia" value={f.direccion} onChange={e => set('direccion', e.target.value)} />
              <label>Referencias (opcional)</label>
              <input maxLength={200} placeholder="Color de la casa, entre qué calles…" value={f.referencias} onChange={e => set('referencias', e.target.value)} />
            </>
          )}
          <label>Método de pago</label>
          <div className="st-pay">
            {metodos.map(([k, t, h]) => (
              <button type="button" key={k} className={f.metodo === k ? 'on' : ''} onClick={() => set('metodo', k)}><b>{t}</b><small>{h}</small></button>
            ))}
          </div>
          {f.metodo === 'efectivo' && (
            <>
              <label>¿Con cuánto pagas? (opcional)</label>
              <input type="number" inputMode="decimal" placeholder="Para llevar tu cambio" value={f.pagaCon} onChange={e => set('pagaCon', e.target.value)} />
            </>
          )}
          <label>Notas del pedido (opcional)</label>
          <textarea rows={2} maxLength={300} placeholder="Ej. sin cebolla, bien picosito…" value={f.notas} onChange={e => set('notas', e.target.value)} />
        </div>

        <div className="st-box st-resumen">
          <h3>Resumen del pedido</h3>
          {items.map(i => (
            <div className="st-line" key={i.id}><Stepper q={i.q} onChange={n => setQty(i.id, n)} /><span>{i.nombre}</span><b>{$(i.q * i.precio)}</b></div>
          ))}
          <div className="st-sum">
            <div><span>Subtotal</span><span>{$(sub)}</span></div>
            {tipo === 'domicilio' && <div><span>Envío</span><span>{envio ? $(envio) : 'Gratis'}</span></div>}
            <div className="t"><span>Total</span><span>{$(total)}</span></div>
          </div>
          {err && <p className="st-err">{err}</p>}
          <button className="st-cta" disabled={busy || !items.length}>{busy ? 'Enviando…' : `Confirmar pedido · ${$(total)}`}</button>
          <p className="st-fine">Al confirmar, el negocio recibe tu pedido al instante.</p>
        </div>
      </form>
    </div>
  )
}

function Gracias({ codigo, tienda, onNuevo }) {
  const [p, setP] = useState(undefined)
  useEffect(() => {
    let on = true
    const f = async () => { const { data } = await supabase.rpc('pedido_estado', { p_codigo: codigo }); if (on) setP(data || null) }
    f()
    const t = setInterval(f, 8000)
    return () => { on = false; clearInterval(t) }
  }, [codigo])

  if (p === undefined) return <div className="st-center">Buscando tu pedido…</div>
  if (p === null) {
    return <div className="st-center"><h2>No encontramos ese pedido</h2><button className="st-cta" onClick={onNuevo}>Ir al menú</button></div>
  }
  const idx = PASOS.indexOf(p.estado)
  const msg = `Hola, soy ${p.cliente}. Hice el pedido ${p.codigo} por ${$(p.total)}:\n` + p.items.map(i => `• ${i.cantidad} × ${i.nombre}`).join('\n')
  const wa = tienda?.whatsapp ? `https://wa.me/${tienda.whatsapp}?text=${encodeURIComponent(msg)}` : null

  return (
    <div className="st-ok">
      <div className="st-box">
        <p className="st-fine">Pedido</p>
        <h1 className="st-code">{p.codigo}</h1>
        <p className="st-state">{iconos[p.estado] || '❌'} {etiqueta(p.estado, p.tipo)}</p>
        {p.estado !== 'cancelado' ? (
          <ol className="st-track">
            {PASOS.map((s, i) => (
              <li key={s} className={i <= idx ? 'done' : ''}><i>{iconos[s]}</i><span>{etiqueta(s, p.tipo)}</span></li>
            ))}
          </ol>
        ) : <p className="st-warn">Tu pedido fue cancelado. Escríbenos por WhatsApp si tienes dudas.</p>}
        <p className="st-fine">Esta pantalla se actualiza sola. Guarda tu código o este enlace para consultarlo después.</p>
        <div className="st-btns">
          {wa && <a className="st-cta wa" href={wa} target="_blank" rel="noreferrer">Avisar por WhatsApp</a>}
          <button className="st-ghost" onClick={() => navigator.clipboard?.writeText(window.location.origin + '/pedido/' + p.codigo).then(() => alert('Enlace copiado'))}>Copiar enlace de seguimiento</button>
          <button className="st-ghost" onClick={onNuevo}>Hacer otro pedido</button>
        </div>
      </div>
      <div className="st-box">
        <h3>Resumen del pedido</h3>
        <p className="st-fine">{p.tipo === 'domicilio' ? '🛵 A domicilio' : '🏪 Recoger en tienda'} · {p.metodo_pago}</p>
        {p.items.map((i, k) => <div className="st-line plain" key={k}><b>{+i.cantidad}×</b><span>{i.nombre}</span><b>{$(i.cantidad * i.precio)}</b></div>)}
        <div className="st-sum">
          <div><span>Subtotal</span><span>{$(p.subtotal)}</span></div>
          {p.tipo === 'domicilio' && <div><span>Envío</span><span>{+p.envio ? $(p.envio) : 'Gratis'}</span></div>}
          <div className="t"><span>Total</span><span>{$(p.total)}</span></div>
        </div>
      </div>
    </div>
  )
}

export default function Store({ codigo: codigoUrl }) {
  const [tienda, setTienda] = useState(null)
  const [cat, setCat] = useState([])
  const [err, setErr] = useState('')
  const [cart, setCart] = useState(() => LS.get('av_cart', {}))
  const [tipo, setTipo] = useState(() => LS.get('av_tipo', 'domicilio'))
  const [view, setView] = useState(codigoUrl ? 'gracias' : 'menu')
  const [codigo, setCodigo] = useState(codigoUrl)
  const [drawer, setDrawer] = useState(false)
  const [q, setQ] = useState('')
  const [activo, setActivo] = useState(null)

  useEffect(() => { LS.set('av_cart', cart) }, [cart])
  useEffect(() => { LS.set('av_tipo', tipo) }, [tipo])
  useEffect(() => {
    (async () => {
      const [t, c] = await Promise.all([
        supabase.from('tienda_publica').select('*').limit(1).maybeSingle(),
        supabase.from('catalogo').select('*').order('categoria').order('nombre'),
      ])
      if (t.error || c.error || !t.data) { setErr('No pudimos cargar el menú. Intenta de nuevo en un momento.'); return }
      setTienda(t.data); setCat(c.data || [])
      setCart(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => (c.data || []).some(p => p.id === id))))
      if (!t.data.acepta_domicilio) setTipo('recoger')
      else if (!t.data.acepta_recoger) setTipo('domicilio')
    })()
  }, [])
  useEffect(() => {
    const ult = LS.get('av_ultimo', null)
    if (!ult || codigoUrl) return
    supabase.rpc('pedido_estado', { p_codigo: ult }).then(({ data }) => {
      if (data && ['nuevo', 'preparando', 'listo'].includes(data.estado)) setActivo(ult)
    })
  }, [codigoUrl])

  const setQty = (id, n) => setCart(c => {
    const r = { ...c }
    if (n <= 0) delete r[id]; else r[id] = Math.min(n, 50)
    return r
  })
  const items = useMemo(() => Object.entries(cart).map(([id, q]) => ({ ...cat.find(p => p.id === id), q })).filter(i => i.nombre), [cart, cat])
  const sub = items.reduce((t, i) => t + i.q * i.precio, 0)
  const envio = tienda && tipo === 'domicilio' ? (tienda.envio_gratis_desde && sub >= +tienda.envio_gratis_desde ? 0 : +tienda.costo_envio) : 0
  const total = sub + envio
  const piezas = items.reduce((t, i) => t + i.q, 0)

  const secciones = useMemo(() => {
    const m = {}
    cat.filter(p => !q || (p.nombre + ' ' + (p.descripcion || '')).toLowerCase().includes(q.toLowerCase())).forEach(p => { (m[p.categoria] = m[p.categoria] || []).push(p) })
    const claves = Object.keys(m).sort((a, b) => (ORDEN.indexOf(a) < 0 ? 99 : ORDEN.indexOf(a)) - (ORDEN.indexOf(b) < 0 ? 99 : ORDEN.indexOf(b)))
    return claves.map(k => [k, m[k]])
  }, [cat, q])
  const destacados = cat.filter(p => p.destacado)

  const home = () => { window.history.pushState(null, '', '/'); setView('menu'); setCodigo(null); window.scrollTo(0, 0) }
  const hecho = c => {
    LS.set('av_ultimo', c); setCart({}); setCodigo(c); setView('gracias'); setDrawer(false)
    window.history.pushState(null, '', '/pedido/' + c); window.scrollTo(0, 0)
  }
  const ir = c => document.getElementById('cat-' + c)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  if (err) return <div className="st"><Top /><div className="st-center"><p>{err}</p></div></div>
  if (!tienda) return <div className="st"><Top /><div className="st-center">Cargando menú…</div></div>

  if (view === 'gracias' && codigo) return <div className="st"><Top tienda={tienda} onHome={home} /><Gracias codigo={codigo} tienda={tienda} onNuevo={home} /><Footer tienda={tienda} /></div>
  if (view === 'checkout') {
    return (
      <div className="st"><Top tienda={tienda} onHome={home} />
        <Checkout tienda={tienda} items={items} sub={sub} envio={envio} total={total} tipo={tipo} setTipo={setTipo} setQty={setQty}
          onBack={() => setView('menu')} onDone={hecho} />
      </div>
    )
  }

  const cartProps = { tienda, items, sub, envio, total, tipo, setQty, onNext: () => { setDrawer(false); setView('checkout'); window.scrollTo(0, 0) } }
  return (
    <div className="st">
      <Top tienda={tienda} onHome={home} />
      <section className="st-hero">
        <div className="st-hero-in">
          <span className={'st-pill ' + (tienda.abierto ? 'ok' : 'off')}>{tienda.abierto ? '● Abierto · recibiendo pedidos' : '● Cerrado por ahora'}</span>
          <h1>{tienda.nombre}</h1>
          {tienda.slogan && <p>{tienda.slogan}</p>}
          <div className="st-meta">
            <span>⏱ {tienda.tiempo_estimado}</span>
            <span>🛵 Envío {+tienda.costo_envio ? $(tienda.costo_envio) : 'gratis'}</span>
            <span>🧾 Mínimo {$(tienda.pedido_minimo)}</span>
            {tienda.zona && <span>📍 {tienda.zona}</span>}
          </div>
        </div>
      </section>

      {activo && (
        <button className="st-banner" onClick={() => { setCodigo(activo); setView('gracias'); window.history.pushState(null, '', '/pedido/' + activo) }}>
          Tienes un pedido en curso ({activo}) · Ver seguimiento →
        </button>
      )}

      <div className="st-modobar"><Modo tienda={tienda} tipo={tipo} setTipo={setTipo} /></div>

      <div className="st-sticky">
        <div className="st-searchrow">
          <input placeholder="Buscar en el menú…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        {!q && (
          <nav className="st-cats">
            {destacados.length > 0 && <button onClick={() => ir('destacados')}>⭐ Destacados</button>}
            {secciones.map(([c]) => <button key={c} onClick={() => ir(c)}>{EMOJI[c] || '🛒'} {c}</button>)}
          </nav>
        )}
      </div>

      <div className="st-wrap">
        <div className="st-menu">
          {!q && destacados.length > 0 && (
            <section id="cat-destacados" className="st-sec">
              <h2>⭐ Los más pedidos</h2>
              <div className="st-list">{destacados.map(p => <Item key={'d' + p.id} p={p} q={cart[p.id]} onQty={n => setQty(p.id, n)} />)}</div>
            </section>
          )}
          {secciones.map(([c, ps]) => (
            <section key={c} id={'cat-' + c} className="st-sec">
              <h2>{EMOJI[c] || '🛒'} {c}</h2>
              <div className="st-list">{ps.map(p => <Item key={p.id} p={p} q={cart[p.id]} onQty={n => setQty(p.id, n)} />)}</div>
            </section>
          ))}
          {secciones.length === 0 && <p className="st-empty">No encontramos productos con “{q}”.</p>}
        </div>
        <aside className="st-side"><Cart {...cartProps} /></aside>
      </div>

      <Footer tienda={tienda} />

      {piezas > 0 && <button className="st-bar" onClick={() => setDrawer(true)}><span>Ver pedido · {piezas}</span><b>{$(total)}</b></button>}
      {drawer && (
        <div className="st-drawer" onClick={() => setDrawer(false)}>
          <div onClick={e => e.stopPropagation()}><Cart {...cartProps} onClose={() => setDrawer(false)} /></div>
        </div>
      )}
    </div>
  )
}

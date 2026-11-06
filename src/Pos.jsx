import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from './supabase'
import { $, iso, fail, hora } from './lib'
import { Compras, Cierre, Evolucion } from './PosReports.jsx'
import { useCola, getCola, encolar, quitar, nuevoId, sincronizar, cacheProds, pendientesPorProducto } from './offline'

const readMem = () => { try { return JSON.parse(localStorage.getItem('av_mem')) } catch { return null } }
const saveMem = m => { try { localStorage.setItem('av_mem', JSON.stringify(m)) } catch { /* sin almacenamiento */ } }
const salir = () => { try { localStorage.removeItem('av_mem') } catch { /* nada */ } supabase.auth.signOut() }

/* ---------------- avisos de pedidos ---------------- */
function beep() {
  try {
    const a = new (window.AudioContext || window.webkitAudioContext)()
    ;[0, 0.28, 0.56].forEach(t => {
      const o = a.createOscillator(), g = a.createGain()
      o.connect(g); g.connect(a.destination); o.frequency.value = 880; g.gain.value = 0.25
      o.start(a.currentTime + t); o.stop(a.currentTime + t + 0.18)
    })
  } catch { /* sin audio */ }
}
function avisar(p) {
  beep()
  try { navigator.vibrate && navigator.vibrate([250, 120, 250]) } catch { /* sin vibración */ }
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Nuevo pedido ' + p.codigo, { body: `${p.cliente} · ${$(p.total)}`, icon: '/logo.jpg' })
    }
  } catch { /* sin notificaciones */ }
}

/* ---------------- sesión ---------------- */
function Logo({ small }) {
  return (
    <div className="brand">
      <img src="/logo.jpg" alt="Logo" />
      <div><span>Antojitos</span> Velázquez{!small && <small>Punto de venta</small>}</div>
    </div>
  )
}

function Login() {
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const entrar = async e => {
    e.preventDefault()
    const { error } = await supabase.auth.signInWithPassword({ email, password: pass })
    fail(error)
  }
  return (
    <div className="login">
      <form className="card" onSubmit={entrar}>
        <Logo />
        <h2>Iniciar sesión</h2>
        <input type="email" placeholder="Correo" value={email} onChange={e => setEmail(e.target.value)} required />
        <input type="password" placeholder="Contraseña" value={pass} onChange={e => setPass(e.target.value)} required />
        <button className="btn">Entrar</button>
      </form>
    </div>
  )
}

function useProductos(nid) {
  const [raw, setRaw] = useState(() => cacheProds.get(nid))
  const cola = useCola(nid)
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('productos').select('*')
      .eq('negocio_id', nid).eq('activo', true).order('categoria').order('nombre')
    if (!error && data) { setRaw(data); cacheProds.set(nid, data) }
  }, [nid])
  useEffect(() => {
    load()
    const ch = supabase.channel('prod-' + nid)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'productos', filter: `negocio_id=eq.${nid}` }, load)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [nid, load])
  // el stock que se ve ya descuenta las ventas guardadas sin internet
  const rows = useMemo(() => {
    const pend = pendientesPorProducto(cola)
    return raw.map(p => (pend[p.id] ? { ...p, stock: +p.stock - pend[p.id] } : p))
  }, [raw, cola])
  return [rows, load]
}

/* ---------------- ticket imprimible ---------------- */
function Ticket({ t, tienda }) {
  if (!t) return null
  return (
    <div className="ticket-print">
      <h2>{tienda?.nombre || 'Antojitos Velázquez'}</h2>
      {tienda?.whatsapp && <p className="c">WhatsApp +{tienda.whatsapp}</p>}
      <p className="c">Folio {t.folio} · {new Date(t.fecha).toLocaleString('es-MX')}</p>
      <hr />
      {t.items.map((i, k) => <div className="tr" key={k}><span>{+i.cantidad} × {i.nombre}</span><span>{$(i.cantidad * i.precio)}</span></div>)}
      <hr />
      {t.descuento > 0 && <div className="tr"><span>Descuento</span><span>-{$(t.descuento)}</span></div>}
      <div className="tr big"><span>TOTAL</span><span>{$(t.total)}</span></div>
      <div className="tr"><span>Pago</span><span>{t.metodo}</span></div>
      {t.pago_con > 0 && <div className="tr"><span>Pagó con</span><span>{$(t.pago_con)}</span></div>}
      {t.cambio > 0 && <div className="tr"><span>Cambio</span><span>{$(t.cambio)}</span></div>}
      <p className="c">¡Gracias por tu compra!</p>
    </div>
  )
}

/* ---------------- cobro ---------------- */
function Cobro({ total, onConfirm, onTicket, onClose }) {
  const [metodo, setMetodo] = useState('efectivo')
  const [pc, setPc] = useState('')
  const [dt, setDt] = useState('$')
  const [dv, setDv] = useState('')
  const [nota, setNota] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)

  const dval = parseFloat(dv) || 0
  const d = Math.min(total, Math.max(0, dt === '%' ? total * dval / 100 : dval))
  const neto = Math.round((total - d) * 100) / 100
  const paga = parseFloat(pc) || 0
  const cambio = metodo === 'efectivo' && paga > 0 ? Math.round((paga - neto) * 100) / 100 : 0
  const falta = metodo === 'efectivo' && paga > 0 && paga < neto

  const cobrar = async () => {
    setBusy(true)
    const t = await onConfirm({ metodo, descuento: d, pagoCon: metodo === 'efectivo' && paga > 0 ? paga : null, nota, neto, cambio: Math.max(cambio, 0) })
    setBusy(false)
    if (t) setDone(t)
  }

  if (done) {
    return (
      <div className="modal" onClick={onClose}>
        <div className="mbox center" onClick={e => e.stopPropagation()}>
          <div className="okmark">✔</div>
          <h2>{done.offline ? 'Venta guardada' : 'Venta registrada'}</h2>
          {done.offline && <p className="mu">Sin internet: se envía sola al volver la conexión.</p>}
          <p className="bigtotal">{$(done.total)}</p>
          {done.cambio > 0 && <p className="cambio">Cambio: {$(done.cambio)}</p>}
          <button className="btn" onClick={() => onTicket(done)}>Imprimir ticket</button>
          <button className="btn s wide" onClick={onClose}>Nueva venta</button>
        </div>
      </div>
    )
  }

  return (
    <div className="modal" onClick={onClose}>
      <div className="mbox" onClick={e => e.stopPropagation()}>
        <div className="mhead"><h2>Cobrar</h2><button className="x" onClick={onClose}>✕</button></div>
        <p className="bigtotal">{$(neto)}</p>
        {d > 0 && <p className="mu center">Subtotal {$(total)} · descuento −{$(d)}</p>}

        <label className="lbl">Método de pago</label>
        <div className="seg">
          {[['efectivo', '💵 Efectivo'], ['transferencia', '📲 Transferencia'], ['tarjeta', '💳 Tarjeta']].map(([k, t]) => (
            <button key={k} className={metodo === k ? 'on' : ''} onClick={() => setMetodo(k)}>{t}</button>
          ))}
        </div>

        {metodo === 'efectivo' && (
          <>
            <label className="lbl">Paga con</label>
            <input type="number" inputMode="decimal" placeholder="Monto recibido" value={pc} onChange={e => setPc(e.target.value)} />
            <div className="quick">
              <button onClick={() => setPc(String(neto))}>Exacto</button>
              {[50, 100, 200, 500].map(n => <button key={n} onClick={() => setPc(String(n))}>${n}</button>)}
            </div>
            {paga > 0 && !falta && <p className="cambio">Cambio: {$(cambio)}</p>}
            {falta && <p className="bad">Faltan {$(neto - paga)}</p>}
          </>
        )}

        <label className="lbl">Descuento</label>
        <div className="row2">
          <input type="number" inputMode="decimal" placeholder="0" value={dv} onChange={e => setDv(e.target.value)} />
          <div className="seg small">
            <button className={dt === '$' ? 'on' : ''} onClick={() => setDt('$')}>$</button>
            <button className={dt === '%' ? 'on' : ''} onClick={() => setDt('%')}>%</button>
          </div>
        </div>
        <input placeholder="Nota (opcional)" value={nota} onChange={e => setNota(e.target.value)} />
        <button className="btn" disabled={busy || falta} onClick={cobrar}>Confirmar cobro · {$(neto)}</button>
      </div>
    </div>
  )
}

/* ---------------- vender ---------------- */
function Vender({ nid, prods, reload, onTicket }) {
  const [cart, setCart] = useState({})
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('Todas')
  const [open, setOpen] = useState(false)
  const [pay, setPay] = useState(false)
  const [hoy, setHoy] = useState({ n: 0, t: 0 })
  const cats = ['Todas', ...new Set(prods.map(p => p.categoria))]

  const loadHoy = useCallback(async () => {
    const { data, error } = await supabase.from('ventas').select('total').eq('negocio_id', nid).eq('fecha', iso()).eq('estado', 'activa')
    if (error) return
    setHoy({ n: (data || []).length, t: (data || []).reduce((s, v) => s + +v.total, 0) })
  }, [nid])
  const cola = useCola(nid)
  useEffect(() => { loadHoy() }, [loadHoy, cola.length])
  const pendT = cola.reduce((s, v) => s + v.total, 0)

  const lista = prods.filter(p => (cat === 'Todas' || p.categoria === cat) && p.nombre.toLowerCase().includes(q.toLowerCase()))
  const ids = Object.keys(cart).filter(id => prods.some(p => p.id === id))
  const total = ids.reduce((t, id) => t + cart[id] * prods.find(p => p.id === id).precio, 0)
  const piezas = ids.reduce((t, id) => t + cart[id], 0)
  const chg = (id, d) => setCart(c => {
    const n = (c[id] || 0) + d, r = { ...c }
    if (n <= 0) delete r[id]; else r[id] = n
    return r
  })

  const confirmar = async ({ metodo, descuento, pagoCon, nota, neto, cambio }) => {
    const cid = nuevoId(), ts = new Date().toISOString()
    let enviado = false
    if (navigator.onLine) {
      const { error, status } = await supabase.rpc('registrar_venta', {
        p_negocio: nid, p_items: ids.map(producto_id => ({ producto_id, cantidad: cart[producto_id] })), p_metodo: metodo,
        p_descuento: descuento, p_pago_con: pagoCon, p_nota: nota || null, p_id: cid, p_ts: ts,
      })
      if (!error) enviado = true
      else if (status !== 0) { fail(error); return null }   // error real del servidor
      // status 0 = no hubo conexión: se guarda en el equipo y se envía después
    }
    const lineas = ids.map(id => { const p = prods.find(x => x.id === id); return { producto_id: id, nombre: p.nombre, cantidad: cart[id], precio: +p.precio, costo: +p.costo } })
    if (!enviado) {
      encolar(nid, {
        cid, ts, metodo, descuento, pago_con: pagoCon, nota: nota || null, total: neto,
        resumen: lineas.map(l => `${l.cantidad}× ${l.nombre}`).join(', '),
        items: lineas.map(({ producto_id, cantidad, precio, costo }) => ({ producto_id, cantidad, precio, costo })),
      })
    }
    const t = {
      folio: cid.slice(0, 6).toUpperCase(), fecha: ts, descuento, total: neto, metodo, pago_con: pagoCon, cambio,
      items: lineas.map(l => ({ nombre: l.nombre, cantidad: l.cantidad, precio: l.precio })), offline: !enviado,
    }
    setCart({})
    if (enviado) { reload(); loadHoy() }
    return t
  }

  return (
    <div className="vlayout">
      <div className="vmain">
        <div className="pagehead">
          <h1>Vender</h1>
          <span className="pill">Hoy {$(hoy.t + pendT)} · {hoy.n + cola.length} ventas{cola.length > 0 ? ` · ⏳ ${cola.length} sin sincronizar` : ''}</span>
        </div>
        <input className="search" placeholder="Buscar producto… (Enter agrega el primero)" value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && lista[0]) { chg(lista[0].id, 1); setQ('') } }} />
        <div className="chips">
          {cats.map(c => <button key={c} className={c === cat ? 'on' : ''} onClick={() => setCat(c)}>{c}</button>)}
        </div>
        <div className="grid">
          {lista.map(p => (
            <button key={p.id} className={'p' + (p.stock <= p.stock_min ? ' low' : '')} onClick={() => chg(p.id, 1)}>
              {cart[p.id] > 0 && <em className="qty">{cart[p.id]}</em>}
              <b>{p.nombre}</b>
              <span>{$(p.precio)}</span>
              <small>Stock {+p.stock}</small>
            </button>
          ))}
        </div>
      </div>

      <aside className={'cartpanel' + (open ? ' open' : '')}>
        <div className="mhead"><h2>Venta actual</h2><button className="x mobileonly" onClick={() => setOpen(false)}>✕</button></div>
        {ids.length === 0 && <p className="mu empty">Toca un producto para agregarlo.</p>}
        <div className="lines">
          {ids.map(id => {
            const p = prods.find(x => x.id === id)
            return (
              <div className="line" key={id}>
                <div><b>{p.nombre}</b><small>{$(p.precio)} c/u</small></div>
                <span className="q"><button onClick={() => chg(id, -1)}>−</button>{cart[id]}<button onClick={() => chg(id, 1)}>+</button></span>
                <b className="amt">{$(cart[id] * p.precio)}</b>
              </div>
            )
          })}
        </div>
        <div className="cartfoot">
          <div className="row tot"><span>Total ({piezas} pzs)</span><b>{$(total)}</b></div>
          <button className="btn big" disabled={!ids.length} onClick={() => { setOpen(false); setPay(true) }}>Cobrar {$(total)}</button>
          {ids.length > 0 && <button className="btn s wide" onClick={() => setCart({})}>Vaciar</button>}
        </div>
      </aside>

      {ids.length > 0 && <button className="cartbar" onClick={() => setOpen(true)}>Ver venta · {piezas} · {$(total)}</button>}
      {pay && <Cobro total={total} onConfirm={confirmar} onTicket={onTicket} onClose={() => setPay(false)} />}
    </div>
  )
}

/* ---------------- pedidos en línea ---------------- */
const SIG = {
  nuevo: ['preparando', 'Aceptar y preparar'],
  preparando: ['listo', null],
  listo: ['entregado', 'Entregado · cobrar'],
}
const ESTADO_TXT = { nuevo: 'Nuevo', preparando: 'Preparando', listo: 'Listo', entregado: 'Entregado', cancelado: 'Cancelado' }

function Pedidos({ nid, tick, reload }) {
  const [f, setF] = useState('activos')
  const [rows, setRows] = useState([])
  const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'denied')

  const load = useCallback(async () => {
    let qy = supabase.from('pedidos').select('*, pedido_items(*)').eq('negocio_id', nid).limit(100)
    if (f === 'activos') qy = qy.in('estado', ['nuevo', 'preparando', 'listo']).order('creado_at', { ascending: true })
    else qy = qy.eq('estado', f === 'entregados' ? 'entregado' : 'cancelado').order('creado_at', { ascending: false })
    const { data } = await qy
    setRows(data || [])
  }, [nid, f])
  useEffect(() => { load() }, [load, tick])

  const mover = async (p, estado) => {
    if (estado === 'cancelado' && !confirm('¿Cancelar este pedido?')) return
    const { error } = await supabase.rpc('cambiar_estado_pedido', { p_pedido: p.id, p_estado: estado })
    if (!fail(error)) { load(); reload() }
  }
  const activar = async () => {
    beep()
    if ('Notification' in window) setPerm(await Notification.requestPermission())
  }
  const siguiente = p => {
    if (p.estado === 'preparando') return ['listo', p.tipo === 'domicilio' ? 'Salió a entregar' : 'Listo para recoger']
    return SIG[p.estado]
  }

  return (
    <>
      <div className="pagehead"><h1>Pedidos en línea</h1></div>
      {perm !== 'granted' && (
        <div className="card info">
          <b>Activa los avisos</b>
          <p className="mu">Para que suene y vibre cuando llegue un pedido. Mantén esta pantalla abierta en el celular o la computadora del negocio.</p>
          <button className="btn s" onClick={activar}>Activar sonido y notificaciones</button>
        </div>
      )}
      <div className="chips">
        {[['activos', 'Activos'], ['entregados', 'Entregados'], ['cancelados', 'Cancelados']].map(([k, t]) => (
          <button key={k} className={f === k ? 'on' : ''} onClick={() => setF(k)}>{t}</button>
        ))}
      </div>
      {rows.length === 0 && <p className="mu">No hay pedidos aquí.</p>}
      <div className="pedgrid">
        {rows.map(p => {
          const sig = siguiente(p)
          return (
            <div className={'card ped ' + p.estado} key={p.id}>
              <div className="row">
                <b className="cod">{p.codigo}</b>
                <span className={'tag ' + p.estado}>{ESTADO_TXT[p.estado]}</span>
              </div>
              <p className="mu">{hora(p.creado_at)} · {p.tipo === 'domicilio' ? '🛵 A domicilio' : '🏪 Recoger'} · {p.metodo_pago}</p>
              <p><b>{p.cliente}</b> · <a href={'tel:' + p.telefono}>{p.telefono}</a> · <a href={'https://wa.me/52' + p.telefono.slice(-10)} target="_blank" rel="noreferrer">WhatsApp</a></p>
              {p.tipo === 'domicilio' && (
                <p>📍 <a href={'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p.direccion || '')} target="_blank" rel="noreferrer">{p.direccion}</a>
                  {p.referencias && <span className="mu"> · {p.referencias}</span>}</p>
              )}
              <ul className="items">
                {(p.pedido_items || []).map(i => <li key={i.id}><span>{+i.cantidad} × {i.nombre}</span><span>{$(i.cantidad * i.precio)}</span></li>)}
              </ul>
              {p.notas && <p className="note">📝 {p.notas}</p>}
              <div className="row"><span className="mu">Envío {$(p.envio)}</span><b className="amt">Total {$(p.total)}</b></div>
              {p.metodo_pago === 'efectivo' && p.paga_con > 0 && <p className="mu">Paga con {$(p.paga_con)} · cambio {$(p.paga_con - p.total)}</p>}
              {sig && (
                <div className="acts">
                  <button className="btn" onClick={() => mover(p, sig[0])}>{sig[1]}</button>
                  <button className="btn s" onClick={() => mover(p, 'cancelado')}>Cancelar</button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

/* ---------------- historial de ventas ---------------- */
function Ventas({ nid, reload, onTicket, online, onSync }) {
  const [d, setD] = useState(iso())
  const [rows, setRows] = useState([])
  const [open, setOpen] = useState(null)
  const cola = useCola(nid)
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('ventas').select('*, venta_items(*)').eq('negocio_id', nid).eq('fecha', d).order('creada_at', { ascending: false })
    if (!error) setRows(data || [])
  }, [nid, d])
  useEffect(() => { load() }, [load, cola.length])

  const activas = rows.filter(v => v.estado === 'activa')
  const por = m => activas.filter(v => v.metodo_pago === m).reduce((t, v) => t + +v.total, 0)
  const anular = async v => {
    if (!confirm('¿Anular esta venta y regresar el stock?')) return
    const { error } = await supabase.rpc('anular_venta', { p_venta: v.id })
    if (!fail(error)) { load(); reload() }
  }
  const ticket = v => onTicket({
    folio: v.id.slice(0, 6).toUpperCase(), fecha: v.creada_at, descuento: +v.descuento, total: +v.total, metodo: v.metodo_pago,
    pago_con: +v.pago_con || 0, cambio: +v.cambio || 0, items: v.venta_items,
  })

  return (
    <>
      <div className="pagehead"><h1>Ventas</h1><input type="date" className="datein" value={d} onChange={e => setD(e.target.value)} /></div>
      {cola.length > 0 && (
        <div className="card info">
          <div className="row"><b>⏳ Ventas sin sincronizar ({cola.length})</b>{online && <button className="btn s" onClick={onSync}>Sincronizar ahora</button>}</div>
          {cola.map(v => (
            <div className="row" key={v.cid}>
              <div><b>{hora(v.ts)}</b> <span className="mu">· {v.resumen}</span>{v.error && <div className="bad">⚠ {v.error}</div>}</div>
              <span><b>{$(v.total)}</b> <button className="icon" aria-label="Eliminar" onClick={() => { if (confirm('Esta venta aún no está en el servidor. ¿Eliminarla?')) quitar(nid, v.cid) }}>🗑</button></span>
            </div>
          ))}
        </div>
      )}
      <div className="stats">
        <div className="stat"><span>Total</span><b>{$(activas.reduce((t, v) => t + +v.total, 0))}</b></div>
        <div className="stat"><span>Efectivo</span><b>{$(por('efectivo'))}</b></div>
        <div className="stat"><span>Transferencia</span><b>{$(por('transferencia'))}</b></div>
        <div className="stat"><span>Tarjeta</span><b>{$(por('tarjeta'))}</b></div>
      </div>
      {!online && <p className="mu">Sin internet: el historial se muestra cuando regrese la conexión.</p>}
      {online && rows.length === 0 && <p className="mu">Sin ventas este día.</p>}
      {rows.map(v => (
        <div className={'card vrow' + (v.estado === 'anulada' ? ' void' : '')} key={v.id}>
          <div className="row" onClick={() => setOpen(open === v.id ? null : v.id)} style={{ cursor: 'pointer' }}>
            <div>
              <b>{hora(v.creada_at)}</b> <span className="mu">· {v.metodo_pago}{v.origen === 'online' ? ' · 🛵 en línea' : ''}{v.nota ? ' · ' + v.nota : ''}</span>
              {v.estado === 'anulada' && <span className="tag cancelado">Anulada</span>}
            </div>
            <b className="amt">{$(v.total)}</b>
          </div>
          {open === v.id && (
            <>
              <ul className="items">
                {v.venta_items.map(i => <li key={i.id}><span>{+i.cantidad} × {i.nombre}</span><span>{$(i.cantidad * i.precio)}</span></li>)}
                {+v.descuento > 0 && <li><span>Descuento</span><span>−{$(v.descuento)}</span></li>}
              </ul>
              <div className="acts">
                <button className="btn s" onClick={() => ticket(v)}>Ticket</button>
                {v.estado === 'activa' && <button className="btn s" onClick={() => anular(v)}>Anular</button>}
              </div>
            </>
          )}
        </div>
      ))}
    </>
  )
}

/* ---------------- caja ---------------- */
function Caja({ nid }) {
  const [t, setT] = useState(undefined)
  const [det, setDet] = useState({ v: [], m: [] })
  const [hist, setHist] = useState([])
  const [fondo, setFondo] = useState('')
  const [mov, setMov] = useState({ tipo: 'retiro', monto: '', concepto: '' })
  const [contado, setContado] = useState('')

  const load = useCallback(async () => {
    const { data: tu } = await supabase.from('caja_turnos').select('*').eq('negocio_id', nid).is('cerrada_at', null)
      .order('abierta_at', { ascending: false }).limit(1).maybeSingle()
    setT(tu || null)
    if (tu) {
      const [v, m] = await Promise.all([
        supabase.from('ventas').select('total,metodo_pago').eq('turno_id', tu.id).eq('estado', 'activa'),
        supabase.from('caja_movimientos').select('*').eq('turno_id', tu.id).order('created_at', { ascending: false }),
      ])
      setDet({ v: v.data || [], m: m.data || [] })
    }
    const { data: h } = await supabase.from('caja_turnos').select('*').eq('negocio_id', nid).not('cerrada_at', 'is', null)
      .order('cerrada_at', { ascending: false }).limit(8)
    setHist(h || [])
  }, [nid])
  useEffect(() => { load() }, [load])

  const abrir = async () => {
    const { error } = await supabase.rpc('abrir_caja', { p_negocio: nid, p_fondo: parseFloat(fondo) || 0 })
    if (!fail(error)) { setFondo(''); load() }
  }
  const mover = async () => {
    const monto = parseFloat(mov.monto)
    if (!monto) return alert('Falta el monto')
    const { error } = await supabase.rpc('mov_caja', { p_turno: t.id, p_tipo: mov.tipo, p_monto: monto, p_concepto: mov.concepto })
    if (!fail(error)) { setMov({ ...mov, monto: '', concepto: '' }); load() }
  }
  const cerrar = async () => {
    if (contado === '') return alert('Cuenta el efectivo y captúralo')
    if (!confirm('¿Cerrar la caja?')) return
    const { data, error } = await supabase.rpc('cerrar_caja', { p_turno: t.id, p_contado: parseFloat(contado) || 0, p_notas: null })
    if (fail(error)) return
    alert(`Esperado ${$(data.esperado)} · Contado ${$(data.contado)} · Diferencia ${$(data.diferencia)}`)
    setContado(''); load()
  }

  if (t === undefined) return <p className="mu">Cargando…</p>
  const por = m => det.v.filter(x => x.metodo_pago === m).reduce((s, x) => s + +x.total, 0)
  const ing = det.m.filter(x => x.tipo === 'ingreso').reduce((s, x) => s + +x.monto, 0)
  const ret = det.m.filter(x => x.tipo === 'retiro').reduce((s, x) => s + +x.monto, 0)
  const esperado = t ? +t.fondo + por('efectivo') + ing - ret : 0

  return (
    <>
      <div className="pagehead"><h1>Caja</h1></div>
      {!t ? (
        <div className="card">
          <b>Caja cerrada</b>
          <p className="mu">Abre la caja con el efectivo con el que inicias (fondo). Las ventas en efectivo se acumulan en el turno.</p>
          <input type="number" inputMode="decimal" placeholder="Fondo inicial $" value={fondo} onChange={e => setFondo(e.target.value)} />
          <button className="btn" onClick={abrir}>Abrir caja</button>
        </div>
      ) : (
        <>
          <div className="stats">
            <div className="stat"><span>Fondo</span><b>{$(t.fondo)}</b></div>
            <div className="stat"><span>Ventas efectivo</span><b>{$(por('efectivo'))}</b></div>
            <div className="stat"><span>Transferencia / tarjeta</span><b>{$(por('transferencia') + por('tarjeta'))}</b></div>
            <div className="stat hl"><span>Efectivo esperado</span><b>{$(esperado)}</b></div>
          </div>
          <p className="mu">Abierta desde {new Date(t.abierta_at).toLocaleString('es-MX')}. Ingresos {$(ing)} · Retiros {$(ret)}.</p>

          <div className="card">
            <b>Ingreso o retiro de efectivo</b>
            <div className="seg small" style={{ marginTop: 8 }}>
              <button className={mov.tipo === 'retiro' ? 'on' : ''} onClick={() => setMov({ ...mov, tipo: 'retiro' })}>Retiro</button>
              <button className={mov.tipo === 'ingreso' ? 'on' : ''} onClick={() => setMov({ ...mov, tipo: 'ingreso' })}>Ingreso</button>
            </div>
            <div className="row2">
              <input type="number" inputMode="decimal" placeholder="Monto $" value={mov.monto} onChange={e => setMov({ ...mov, monto: e.target.value })} />
              <input placeholder="Concepto (ej. compra de hielo)" value={mov.concepto} onChange={e => setMov({ ...mov, concepto: e.target.value })} />
            </div>
            <button className="btn s wide" onClick={mover}>Registrar</button>
            {det.m.map(m => <div className="row" key={m.id}><span>{m.tipo === 'retiro' ? '−' : '+'} {m.concepto || m.tipo}</span><b>{$(m.monto)}</b></div>)}
          </div>

          <div className="card">
            <b>Cerrar caja (arqueo)</b>
            <p className="mu">Cuenta el efectivo que hay en caja y captúralo. El sistema calcula la diferencia contra {$(esperado)}.</p>
            <input type="number" inputMode="decimal" placeholder="Efectivo contado $" value={contado} onChange={e => setContado(e.target.value)} />
            {contado !== '' && <p className={(parseFloat(contado) || 0) - esperado === 0 ? 'g' : 'bad'}>Diferencia: {$((parseFloat(contado) || 0) - esperado)}</p>}
            <button className="btn" onClick={cerrar}>Cerrar caja</button>
          </div>
        </>
      )}
      {hist.length > 0 && (
        <>
          <h3>Últimos cortes</h3>
          <div className="wrap">
            <table>
              <thead><tr><th>Cierre</th><th>Esperado</th><th>Contado</th><th>Dif.</th></tr></thead>
              <tbody>{hist.map(h => <tr key={h.id}><td>{new Date(h.cerrada_at).toLocaleDateString('es-MX')}</td><td>{$(h.esperado)}</td><td>{$(h.contado)}</td><td className={+h.diferencia === 0 ? 'g' : 'bad'}>{$(h.diferencia)}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}

/* ---------------- stock y productos ---------------- */
function ProductoModal({ p, onClose, onSave }) {
  const [f, setF] = useState({ ...p })
  const set = (k, v) => setF({ ...f, [k]: v })
  return (
    <div className="modal" onClick={onClose}>
      <div className="mbox" onClick={e => e.stopPropagation()}>
        <div className="mhead"><h2>Editar producto</h2><button className="x" onClick={onClose}>✕</button></div>
        <label className="lbl">Nombre</label>
        <input value={f.nombre} onChange={e => set('nombre', e.target.value)} />
        <label className="lbl">Categoría</label>
        <input value={f.categoria} onChange={e => set('categoria', e.target.value)} />
        <label className="lbl">Descripción (se ve en la tienda)</label>
        <textarea rows={2} value={f.descripcion || ''} onChange={e => set('descripcion', e.target.value)} />
        <label className="lbl">Foto (enlace de la imagen)</label>
        <input placeholder="https://…" value={f.imagen_url || ''} onChange={e => set('imagen_url', e.target.value)} />
        <label className="chk"><input type="checkbox" checked={f.en_linea} onChange={e => set('en_linea', e.target.checked)} /> Visible en la tienda en línea</label>
        <label className="chk"><input type="checkbox" checked={f.destacado} onChange={e => set('destacado', e.target.checked)} /> Destacado (aparece arriba)</label>
        <label className="chk"><input type="checkbox" checked={f.activo} onChange={e => set('activo', e.target.checked)} /> Activo en el punto de venta</label>
        <button className="btn" onClick={() => onSave({
          nombre: f.nombre.trim(), categoria: f.categoria.trim() || 'Otros', descripcion: f.descripcion || null,
          imagen_url: f.imagen_url || null, en_linea: f.en_linea, destacado: f.destacado, activo: f.activo,
        })}>Guardar</button>
      </div>
    </div>
  )
}

function Stock({ nid, prods, reload, admin }) {
  const [all, setAll] = useState([])
  const [ed, setEd] = useState(null)
  const [nuevo, setNuevo] = useState({ nombre: '', categoria: 'Botanas', precio: '', costo: '' })
  const load = useCallback(async () => {
    const { data } = await supabase.from('productos').select('*').eq('negocio_id', nid).order('categoria').order('nombre')
    setAll(data || [])
  }, [nid])
  useEffect(() => { load() }, [load, prods])

  const upd = async (id, f, v) => {
    const { error } = await supabase.from('productos').update({ [f]: parseFloat(v) || 0 }).eq('id', id)
    if (!fail(error)) { load(); reload() }
  }
  const ajustar = async (id, v) => {
    const { error } = await supabase.rpc('ajustar_stock', { p_producto: id, p_nuevo: parseFloat(v) || 0 })
    if (!fail(error)) { load(); reload() }
  }
  const guardar = async cambios => {
    const { error } = await supabase.from('productos').update(cambios).eq('id', ed.id)
    if (!fail(error)) { setEd(null); load(); reload() }
  }
  const crear = async () => {
    if (!nuevo.nombre.trim()) return
    const { error } = await supabase.from('productos').insert({
      negocio_id: nid, nombre: nuevo.nombre.trim(), categoria: nuevo.categoria || 'Otros',
      precio: parseFloat(nuevo.precio) || 0, costo: parseFloat(nuevo.costo) || 0,
    })
    if (!fail(error)) { setNuevo({ nombre: '', categoria: 'Botanas', precio: '', costo: '' }); load(); reload() }
  }
  const num = (p, f, step) => (
    <input className="n" type="number" step={step} disabled={!admin} key={p.id + f + p[f]} defaultValue={+p[f]}
      onBlur={e => +e.target.value !== +p[f] && upd(p.id, f, e.target.value)} />
  )

  return (
    <>
      <div className="pagehead"><h1>Stock y productos</h1></div>
      <p className="mu">Rojo = stock bajo el mínimo. Costo en 0 = falta capturarlo (la ganancia sale inflada). 🛵 = visible en la tienda en línea.</p>
      <div className="wrap card flush">
        <table>
          <thead><tr><th>Producto</th><th>Stock</th><th>Mín</th><th>Precio</th><th>Costo</th><th></th></tr></thead>
          <tbody>
            {all.map(p => (
              <tr key={p.id} className={p.activo ? '' : 'inactive'}>
                <td className={p.stock <= p.stock_min ? 'bad' : ''}>{p.en_linea && p.activo ? '🛵 ' : ''}{p.nombre}</td>
                <td><input className="n" type="number" key={p.id + 's' + p.stock} defaultValue={+p.stock}
                  onBlur={e => +e.target.value !== +p.stock && ajustar(p.id, e.target.value)} /></td>
                <td>{num(p, 'stock_min', 1)}</td><td>{num(p, 'precio', 1)}</td><td>{num(p, 'costo', 0.01)}</td>
                <td>{admin && <button className="icon" onClick={() => setEd(p)} aria-label="Editar">✎</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {admin && (
        <>
          <h3>Producto nuevo</h3>
          <div className="card">
            <input placeholder="Nombre" value={nuevo.nombre} onChange={e => setNuevo({ ...nuevo, nombre: e.target.value })} />
            <input placeholder="Categoría" value={nuevo.categoria} onChange={e => setNuevo({ ...nuevo, categoria: e.target.value })} />
            <div className="row2">
              <input type="number" placeholder="Precio" value={nuevo.precio} onChange={e => setNuevo({ ...nuevo, precio: e.target.value })} />
              <input type="number" placeholder="Costo" value={nuevo.costo} onChange={e => setNuevo({ ...nuevo, costo: e.target.value })} />
            </div>
            <button className="btn" onClick={crear}>Agregar</button>
          </div>
        </>
      )}
      {ed && <ProductoModal p={ed} onClose={() => setEd(null)} onSave={guardar} />}
    </>
  )
}

/* ---------------- ajustes de la tienda ---------------- */
function Ajustes({ nid }) {
  const [t, setT] = useState(null)
  useEffect(() => { supabase.from('tienda').select('*').eq('negocio_id', nid).maybeSingle().then(({ data }) => setT(data)) }, [nid])
  if (!t) return <p className="mu">Cargando…</p>
  const set = (k, v) => setT({ ...t, [k]: v })
  const guardar = async () => {
    const { negocio_id, ...r } = t
    const { error } = await supabase.from('tienda').update({
      ...r, costo_envio: +r.costo_envio || 0, pedido_minimo: +r.pedido_minimo || 0,
      envio_gratis_desde: r.envio_gratis_desde === '' || r.envio_gratis_desde == null ? null : +r.envio_gratis_desde,
    }).eq('negocio_id', nid)
    if (!fail(error)) alert('Guardado')
  }
  const url = window.location.origin + '/'
  const txt = (k, label, ph) => (<><label className="lbl">{label}</label><input placeholder={ph || ''} value={t[k] ?? ''} onChange={e => set(k, e.target.value)} /></>)
  return (
    <>
      <div className="pagehead"><h1>Ajustes de la tienda</h1></div>
      <div className="card">
        <b>Enlace para tus clientes</b>
        <p className="mu">Compártelo en tu Fanpage, WhatsApp y anuncios. El punto de venta está en /pos.</p>
        <input readOnly value={url} onFocus={e => e.target.select()} />
        <button className="btn s wide" onClick={() => navigator.clipboard?.writeText(url).then(() => alert('Enlace copiado'))}>Copiar enlace</button>
      </div>
      <div className="card">
        <label className="chk big"><input type="checkbox" checked={t.abierto} onChange={e => set('abierto', e.target.checked)} /> Recibiendo pedidos ahora (tienda abierta)</label>
        <label className="chk"><input type="checkbox" checked={t.acepta_domicilio} onChange={e => set('acepta_domicilio', e.target.checked)} /> Entrega a domicilio</label>
        <label className="chk"><input type="checkbox" checked={t.acepta_recoger} onChange={e => set('acepta_recoger', e.target.checked)} /> Recoger en tienda</label>
        {txt('nombre', 'Nombre')}
        {txt('slogan', 'Lema')}
        {txt('whatsapp', 'WhatsApp (solo números, con 52)', '525537750517')}
        <div className="row2">
          <div><label className="lbl">Costo de envío $</label><input type="number" value={t.costo_envio} onChange={e => set('costo_envio', e.target.value)} /></div>
          <div><label className="lbl">Pedido mínimo $</label><input type="number" value={t.pedido_minimo} onChange={e => set('pedido_minimo', e.target.value)} /></div>
        </div>
        <label className="lbl">Envío gratis desde $ (opcional)</label>
        <input type="number" value={t.envio_gratis_desde ?? ''} onChange={e => set('envio_gratis_desde', e.target.value)} />
        {txt('tiempo_estimado', 'Tiempo estimado', '25–40 min')}
        {txt('zona', 'Zona de entrega', 'Colonias o cobertura')}
        {txt('horario', 'Horario', 'Lun a Sáb · 8:00 a 20:00')}
        {txt('direccion', 'Dirección del negocio')}
        <button className="btn" onClick={guardar}>Guardar cambios</button>
      </div>
    </>
  )
}

/* ---------------- estructura principal ---------------- */
function Shell({ nid, admin }) {
  const [prods, reload] = useProductos(nid)
  const [tab, setTab] = useState('v')
  const [mas, setMas] = useState(false)
  const [tick, setTick] = useState(0)
  const [nuevos, setNuevos] = useState(0)
  const [aviso, setAviso] = useState(null)
  const [ticket, setTicket] = useState(null)
  const [tienda, setTienda] = useState(null)
  const cola = useCola(nid)
  const [online, setOnline] = useState(navigator.onLine)
  const [syncMsg, setSyncMsg] = useState('')
  const [sinSesion, setSinSesion] = useState(false)
  const sync = useCallback(async (todo = false) => {
    const r = await sincronizar(nid, todo === true)
    setSinSesion(!!r.sinSesion)
    if (r.ok) {
      reload()
      setSyncMsg(`✔ ${r.ok} venta${r.ok === 1 ? '' : 's'} sincronizada${r.ok === 1 ? '' : 's'}`)
      setTimeout(() => setSyncMsg(''), 5000)
    }
  }, [nid, reload])
  const syncManual = () => sync(true)
  useEffect(() => {
    const on = () => { setOnline(true); sync() }, off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [sync])
  useEffect(() => { if (navigator.onLine && getCola(nid).length) sync() }, [nid, sync])
  useEffect(() => {
    if (!online || !cola.length) return
    const t = setInterval(() => sync(), 30000)
    return () => clearInterval(t)
  }, [online, cola.length, sync])

  const contar = useCallback(async () => {
    const { count } = await supabase.from('pedidos').select('id', { count: 'exact', head: true }).eq('negocio_id', nid).eq('estado', 'nuevo')
    setNuevos(count || 0)
  }, [nid])
  useEffect(() => {
    contar()
    const ch = supabase.channel('ped-' + nid)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos', filter: `negocio_id=eq.${nid}` }, p => {
        setTick(t => t + 1); contar()
        if (p.eventType === 'INSERT') { avisar(p.new); setAviso(p.new) }
      }).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [nid, contar])
  useEffect(() => { supabase.from('tienda_publica').select('*').eq('negocio_id', nid).maybeSingle().then(({ data }) => setTienda(data)) }, [nid])
  useEffect(() => { document.title = nuevos ? `(${nuevos}) Pedidos nuevos · Antojitos` : 'Antojitos Velázquez · POS' }, [nuevos])

  const imprimir = t => { setTicket(t); setTimeout(() => window.print(), 200) }
  const tabs = [['v', 'Vender', '🧾'], ['p', 'Pedidos', '🛵'], ['h', 'Ventas', '📋'], ['j', 'Caja', '💵'],
    ['s', 'Stock', '📦'], ['c', 'Compras', '🛒'], ['x', 'Cierre', '📊'], ['e', 'Evolución', '📈'], ...(admin ? [['a', 'Ajustes', '⚙️']] : [])]
  const go = k => { setTab(k); setMas(false) }
  const Btn = ([k, t, i]) => (
    <button key={k} className={tab === k ? 'on' : ''} onClick={() => go(k)}>
      <i>{i}</i><span>{t}</span>{k === 'p' && nuevos > 0 && <em className="badge">{nuevos}</em>}
    </button>
  )

  return (
    <>
      <div className="app">
        <aside className="sidebar">
          <Logo />
          <nav>{tabs.map(Btn)}</nav>
          <button className="out" onClick={salir}>Cerrar sesión</button>
        </aside>
        <div className="main">
          <div className="topbar"><Logo small /><button className="out" onClick={salir}>Salir</button></div>
          {aviso && (
            <div className="toast">
              <span>🔔 Nuevo pedido <b>{aviso.codigo}</b> · {$(aviso.total)}</span>
              <button onClick={() => { go('p'); setAviso(null) }}>Ver</button>
              <button onClick={() => setAviso(null)}>✕</button>
            </div>
          )}
          <div className="content">
            {(!online || cola.length > 0 || syncMsg) && (
              <div className={'netbar ' + (!online ? 'off' : syncMsg && !cola.length ? 'ok' : 'sync')}>
                <span>
                  {!online ? `📴 Sin internet · las ventas se guardan en este equipo${cola.length ? ` (${cola.length} pendientes)` : ''}`
                    : syncMsg && !cola.length ? syncMsg
                    : sinSesion ? '🔐 Inicia sesión de nuevo para sincronizar tus ventas pendientes'
                    : `🔄 ${cola.length} venta${cola.length === 1 ? '' : 's'} por sincronizar${cola.some(v => v.error) ? ' · hay errores (ver Ventas)' : ''}`}
                </span>
                {online && cola.length > 0 && <button onClick={sinSesion ? salir : syncManual}>{sinSesion ? 'Iniciar sesión' : 'Sincronizar ahora'}</button>}
              </div>
            )}
            {!online && !['v', 'h'].includes(tab) ? (
              <div className="card info"><b>Esta sección necesita internet</b><p className="mu">Puedes seguir vendiendo en <b>Vender</b>. Las ventas se enviarán solas cuando regrese la conexión.</p></div>
            ) : <>
            {tab === 'v' && <Vender nid={nid} prods={prods} reload={reload} onTicket={imprimir} />}
            {tab === 'p' && <Pedidos nid={nid} tick={tick} reload={reload} />}
            {tab === 'h' && <Ventas nid={nid} reload={reload} onTicket={imprimir} online={online} onSync={syncManual} />}
            {tab === 'j' && <Caja nid={nid} />}
            {tab === 's' && <Stock nid={nid} prods={prods} reload={reload} admin={admin} />}
            {tab === 'c' && <><div className="pagehead"><h1>Compras y gastos</h1></div><Compras nid={nid} prods={prods} reload={reload} /></>}
            {tab === 'x' && <><div className="pagehead"><h1>Cierre y corte</h1></div><Cierre nid={nid} admin={admin} /></>}
            {tab === 'e' && <><div className="pagehead"><h1>Evolución del negocio</h1></div><Evolucion nid={nid} /></>}
            {tab === 'a' && admin && <Ajustes nid={nid} />}
            </>}
          </div>
        </div>
      </div>
      <nav className="bnav">
        {tabs.slice(0, 4).map(Btn)}
        <button className={mas ? 'on' : ''} onClick={() => setMas(m => !m)}><i>☰</i><span>Más</span></button>
      </nav>
      {mas && (
        <div className="sheet" onClick={() => setMas(false)}>
          <div onClick={e => e.stopPropagation()}>{tabs.slice(4).map(Btn)}<button onClick={salir}><i>🚪</i><span>Salir</span></button></div>
        </div>
      )}
      <Ticket t={ticket} tienda={tienda} />
    </>
  )
}

export default function Pos() {
  const [session, setSession] = useState(undefined)
  const [mem, setMem] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data, error }) => {
      const cache = readMem()
      // sin internet (o sin poder renovar la sesión) se entra con la última sesión usada en este equipo
      if (!data.session && cache && (!navigator.onLine || error?.name === 'AuthRetryableFetchError')) {
        setMem(cache); setSession({ offline: true })
      } else setSession(data.session)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((ev, s) => {
      if (s) setSession(s)
      else if (ev === 'SIGNED_OUT') setSession(null)
    })
    const volvio = () => supabase.auth.getSession().then(({ data }) => { if (data.session) setSession(data.session) })
    window.addEventListener('online', volvio)
    return () => { sub.subscription.unsubscribe(); window.removeEventListener('online', volvio) }
  }, [])
  useEffect(() => {
    if (!session) { setMem(null); return }
    if (session.offline) return
    supabase.from('miembros').select('negocio_id,rol').limit(1).maybeSingle().then(({ data, error }) => {
      if (data) { saveMem(data); setMem(data) } else setMem(error ? (readMem() || false) : false)
    })
  }, [session])

  if (session === undefined || (session && mem === null)) return <p style={{ padding: 20 }}>Cargando…</p>
  if (!session) return <Login />
  if (mem === false) return <div className="login"><div className="card">Tu usuario no está asignado a ningún negocio. Corre el seed.sql con tu correo.<button className="btn" onClick={salir}>Salir</button></div></div>
  return <Shell nid={mem.negocio_id} admin={['admin', 'socio'].includes(mem.rol)} />
}

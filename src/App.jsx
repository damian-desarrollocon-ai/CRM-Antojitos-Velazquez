import { useEffect, useState, useCallback } from 'react'
import { supabase } from './supabase'

const $ = n => '$' + (Math.round((+n || 0) * 100) / 100).toLocaleString('es-MX')
const iso = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d) }
const weekStart = s => addDays(s, -new Date(s + 'T12:00:00').getDay())
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const fail = e => { if (e) alert(e.message); return !!e }

function Head({ out }) {
  return (
    <header>
      <img src="/logo.jpg" alt="Logo" />
      <div><span>Antojitos</span> Velázquez</div>
      {out && <button className="out" onClick={out}>Salir</button>}
    </header>
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
    <>
      <Head />
      <main>
        <form className="card" onSubmit={entrar}>
          <b>Iniciar sesión</b>
          <input type="email" placeholder="Correo" value={email} onChange={e => setEmail(e.target.value)} required />
          <input type="password" placeholder="Contraseña" value={pass} onChange={e => setPass(e.target.value)} required />
          <button className="btn">Entrar</button>
        </form>
      </main>
    </>
  )
}

function useProductos(nid) {
  const [rows, setRows] = useState([])
  const load = useCallback(async () => {
    const { data } = await supabase.from('productos').select('*')
      .eq('negocio_id', nid).eq('activo', true).order('categoria').order('nombre')
    setRows(data || [])
  }, [nid])
  useEffect(() => {
    load()
    const ch = supabase.channel('prod-' + nid)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'productos', filter: `negocio_id=eq.${nid}` }, load)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [nid, load])
  return [rows, load]
}

function Vender({ nid, prods, reload }) {
  const [cart, setCart] = useState({})
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('Todas')
  const [hoy, setHoy] = useState([])
  const [busy, setBusy] = useState(false)
  const cats = ['Todas', ...new Set(prods.map(p => p.categoria))]
  const loadHoy = useCallback(async () => {
    const { data } = await supabase.from('ventas').select('id,total,creada_at')
      .eq('negocio_id', nid).eq('fecha', iso()).eq('estado', 'activa').order('creada_at', { ascending: false })
    setHoy(data || [])
  }, [nid])
  useEffect(() => { loadHoy() }, [loadHoy])

  const lista = prods.filter(p => (cat === 'Todas' || p.categoria === cat) && p.nombre.toLowerCase().includes(q.toLowerCase()))
  const ids = Object.keys(cart).filter(id => prods.some(p => p.id === id))
  const total = ids.reduce((t, id) => t + cart[id] * prods.find(p => p.id === id).precio, 0)
  const chg = (id, d) => setCart(c => {
    const n = (c[id] || 0) + d, r = { ...c }
    if (n <= 0) delete r[id]; else r[id] = n
    return r
  })

  const cobrar = async () => {
    setBusy(true)
    const items = ids.map(producto_id => ({ producto_id, cantidad: cart[producto_id] }))
    const { error } = await supabase.rpc('registrar_venta', { p_negocio: nid, p_items: items })
    setBusy(false)
    if (fail(error)) return
    setCart({}); reload(); loadHoy()
  }
  const anular = async () => {
    if (!confirm('¿Anular la última venta y regresar el stock?')) return
    const { error } = await supabase.rpc('anular_venta', { p_venta: hoy[0].id })
    if (!fail(error)) { reload(); loadHoy() }
  }

  return (
    <>
      <input placeholder="Buscar producto" value={q} onChange={e => setQ(e.target.value)} />
      <div className="chips">
        {cats.map(c => <button key={c} className={c === cat ? 'on' : ''} onClick={() => setCat(c)}>{c}</button>)}
      </div>
      <div className="grid">
        {lista.map(p => (
          <button key={p.id} className={'p' + (p.stock <= p.stock_min ? ' low' : '')} onClick={() => chg(p.id, 1)}>
            <b>{p.nombre}</b><span>{$(p.precio)}</span>
            <small>Stock: {+p.stock}{cart[p.id] ? ` · 🛒${cart[p.id]}` : ''}</small>
          </button>
        ))}
      </div>
      {ids.length > 0 && (
        <div className="card">
          <b>Venta actual</b>
          {ids.map(id => {
            const p = prods.find(x => x.id === id)
            return (
              <div className="row" key={id}>
                <span>{p.nombre}</span>
                <span className="q"><button onClick={() => chg(id, -1)}>−</button>{cart[id]}<button onClick={() => chg(id, 1)}>+</button></span>
                <b>{$(cart[id] * p.precio)}</b>
              </div>
            )
          })}
          <button className="btn" disabled={busy} onClick={cobrar}>Cobrar {$(total)}</button>
          <button className="btn s" style={{ marginTop: 6 }} onClick={() => setCart({})}>Vaciar</button>
        </div>
      )}
      <h3>Hoy: {$(hoy.reduce((t, v) => t + +v.total, 0))} <span className="mu">({hoy.length} ventas)</span></h3>
      {hoy.length > 0 && <button className="btn s" onClick={anular}>Anular última venta</button>}
    </>
  )
}

function Stock({ nid, prods, reload, admin }) {
  const [nuevo, setNuevo] = useState({ nombre: '', categoria: 'Botanas', precio: '', costo: '' })
  const upd = async (id, f, v) => {
    const { error } = await supabase.from('productos').update({ [f]: parseFloat(v) || 0 }).eq('id', id)
    if (!fail(error)) reload()
  }
  const ajustar = async (id, v) => {
    const { error } = await supabase.rpc('ajustar_stock', { p_producto: id, p_nuevo: parseFloat(v) || 0 })
    if (!fail(error)) reload()
  }
  const crear = async () => {
    if (!nuevo.nombre.trim()) return
    const { error } = await supabase.from('productos').insert({
      negocio_id: nid, nombre: nuevo.nombre.trim(), categoria: nuevo.categoria || 'Otros',
      precio: parseFloat(nuevo.precio) || 0, costo: parseFloat(nuevo.costo) || 0,
    })
    if (!fail(error)) { setNuevo({ nombre: '', categoria: 'Botanas', precio: '', costo: '' }); reload() }
  }
  const num = (p, f, step) => (
    <input className="n" type="number" step={step} disabled={!admin} key={p.id + f + p[f]} defaultValue={+p[f]}
      onBlur={e => +e.target.value !== +p[f] && upd(p.id, f, e.target.value)} />
  )
  return (
    <>
      <p className="mu">Rojo = stock por debajo del mínimo. Costo en 0 = falta capturarlo (la ganancia sale inflada).</p>
      <div className="wrap">
        <table>
          <thead><tr><th>Producto</th><th>Stock</th><th>Mín</th><th>Precio</th><th>Costo</th></tr></thead>
          <tbody>
            {prods.map(p => (
              <tr key={p.id}>
                <td className={p.stock <= p.stock_min ? 'bad' : ''}>{p.nombre}</td>
                <td><input className="n" type="number" key={p.id + 's' + p.stock} defaultValue={+p.stock}
                  onBlur={e => +e.target.value !== +p.stock && ajustar(p.id, e.target.value)} /></td>
                <td>{num(p, 'stock_min', 1)}</td><td>{num(p, 'precio', 1)}</td><td>{num(p, 'costo', 0.01)}</td>
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
            <div className="row">
              <input type="number" placeholder="Precio" value={nuevo.precio} onChange={e => setNuevo({ ...nuevo, precio: e.target.value })} />
              <input type="number" placeholder="Costo" value={nuevo.costo} onChange={e => setNuevo({ ...nuevo, costo: e.target.value })} />
            </div>
            <button className="btn" onClick={crear}>Agregar</button>
          </div>
        </>
      )}
    </>
  )
}

function Compras({ nid, prods, reload }) {
  const vacio = { producto: '', insumo: '', monto: '', piezas: '', fecha: iso(), categoria: 'General' }
  const [f, setF] = useState(vacio)
  const [lista, setLista] = useState([])
  const cargar = useCallback(async () => {
    const { data } = await supabase.from('compras').select('id,fecha,insumo,monto')
      .eq('negocio_id', nid).order('fecha', { ascending: false }).order('created_at', { ascending: false }).limit(20)
    setLista(data || [])
  }, [nid])
  useEffect(() => { cargar() }, [cargar])

  const guardar = async () => {
    const p = prods.find(x => x.id === f.producto)
    const monto = parseFloat(f.monto)
    if (!monto) return alert('Falta el monto')
    const { error } = await supabase.rpc('registrar_compra', {
      p_negocio: nid, p_fecha: f.fecha, p_categoria: f.categoria, p_insumo: f.insumo.trim() || (p ? p.nombre : 'Gasto'),
      p_monto: monto, p_producto: p ? p.id : null, p_piezas: parseFloat(f.piezas) || 0, p_notas: null,
    })
    if (fail(error)) return
    setF({ ...vacio, fecha: f.fecha }); cargar(); reload()
  }
  return (
    <>
      <div className="card">
        <b>Registrar compra o ticket</b>
        <select value={f.producto} onChange={e => setF({ ...f, producto: e.target.value })}>
          <option value="">Otro gasto (sin stock)</option>
          {prods.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
        <input placeholder="Concepto (ej. 1 kg gomitas, hielo, aceite)" value={f.insumo} onChange={e => setF({ ...f, insumo: e.target.value })} />
        <div className="row">
          <input type="number" placeholder="Monto total $" value={f.monto} onChange={e => setF({ ...f, monto: e.target.value })} />
          <input type="number" placeholder="Piezas que entran" value={f.piezas} onChange={e => setF({ ...f, piezas: e.target.value })} />
        </div>
        <input type="date" value={f.fecha} onChange={e => setF({ ...f, fecha: e.target.value })} />
        <button className="btn" onClick={guardar}>Guardar compra</button>
        <p className="mu">Si eliges producto y pones piezas, el stock sube y el costo por pieza se actualiza.</p>
      </div>
      <h3>Últimas compras</h3>
      {lista.map(c => <div className="row" key={c.id}><span>{c.fecha} · {c.insumo}</span><b>{$(c.monto)}</b></div>)}
    </>
  )
}

function Cierre({ nid, admin }) {
  const [d, setD] = useState(iso())
  const [pct, setPct] = useState(25)
  const [res, setRes] = useState([])
  const [com, setCom] = useState([])
  const [socios, setSocios] = useState([])
  const [txt, setTxt] = useState('')
  const w = weekStart(d)
  const dias = [...Array(7)].map((_, i) => addDays(w, i))

  useEffect(() => {
    (async () => {
      const [a, b, c] = await Promise.all([
        supabase.from('ventas_diarias').select('fecha,ventas,costo,ganancia').eq('negocio_id', nid).gte('fecha', dias[0]).lte('fecha', dias[6]),
        supabase.from('compras').select('fecha,monto').eq('negocio_id', nid).gte('fecha', dias[0]).lte('fecha', dias[6]),
        supabase.from('socios').select('*').eq('negocio_id', nid).order('nombre'),
      ])
      setRes(a.data || []); setCom(b.data || []); setSocios(c.data || [])
    })()
  }, [nid, w])

  const dia = x => {
    const r = res.find(v => v.fecha === x) || {}
    return { v: +r.ventas || 0, c: +r.costo || 0, g: +r.ganancia || 0, b: com.filter(k => k.fecha === x).reduce((t, k) => t + +k.monto, 0) }
  }
  const hoy = dia(d)
  const sem = dias.map(dia)
  const tv = sem.reduce((t, x) => t + x.v, 0), tc = sem.reduce((t, x) => t + x.c, 0), tb = sem.reduce((t, x) => t + x.b, 0)
  const gan = tv - tc, reinv = gan * pct / 100, repartir = gan - reinv

  const guardarCorte = async () => {
    const { error } = await supabase.from('cortes').upsert({
      negocio_id: nid, semana_inicio: w, ventas: tv, costo: tc, ganancia: gan, pct_reinversion: pct, reinversion: reinv, repartir,
      reparto: socios.map(s => ({ socio: s.nombre, monto: +(repartir * s.porcentaje / 100).toFixed(2) })),
    }, { onConflict: 'negocio_id,semana_inicio' })
    if (!fail(error)) alert('Corte guardado')
  }
  const importar = async () => {
    let data
    try { data = JSON.parse(txt) } catch { return alert('Respaldo no válido') }
    const { data: r, error } = await supabase.rpc('importar_respaldo_v1', { p_negocio: nid, p_data: data })
    if (!fail(error)) alert(`Importado: ${r.productos} productos, ${r.ventas} ventas, ${r.compras} compras. Recarga la página.`)
  }

  return (
    <>
      <input type="date" value={d} onChange={e => setD(e.target.value)} />
      <div className="card">
        <div className="row"><span>Ventas</span><b>{$(hoy.v)}</b></div>
        <div className="row"><span>Dejar para resurtir (costo)</span><b>{$(hoy.c)}</b></div>
        <div className="row"><span>Ganancia del día</span><b className="g">{$(hoy.g)}</b></div>
        <div className="row"><span>Compras/gastos del día</span><b>{$(hoy.b)}</b></div>
      </div>
      <h3>Semana (dom–sáb)</h3>
      <div className="wrap">
        <table>
          <thead><tr><th>Día</th><th>Ventas</th><th>Ganancia</th><th>Compras</th></tr></thead>
          <tbody>
            {sem.map((x, i) => <tr key={i}><td>{DIAS[i]} {dias[i].slice(8)}</td><td>{$(x.v)}</td><td>{$(x.g)}</td><td>{$(x.b)}</td></tr>)}
            <tr><th>Total</th><th>{$(tv)}</th><th>{$(gan)}</th><th>{$(tb)}</th></tr>
          </tbody>
        </table>
      </div>
      <div className="card">
        <b>Corte del sábado</b>
        <div className="row"><span>% para crecer</span><input className="n" type="number" value={pct} onChange={e => setPct(parseFloat(e.target.value) || 0)} /></div>
        <div className="row"><span>Ganancia semana</span><b>{$(gan)}</b></div>
        <div className="row"><span>Para crecer</span><b>{$(reinv)}</b></div>
        <div className="row"><span>A repartir</span><b className="g">{$(repartir)}</b></div>
        {socios.map(s => <div className="row" key={s.id}><span>{s.nombre} ({+s.porcentaje}%)</span><b className="g">{$(repartir * s.porcentaje / 100)}</b></div>)}
        {admin && <button className="btn" onClick={guardarCorte}>Guardar corte</button>}
        <p className="mu">La ganancia usa el costo de cada producto; si un costo está en 0, sale inflada.</p>
      </div>
      {admin && (
        <>
          <h3>Importar respaldo del POS v1 (una sola vez)</h3>
          <textarea rows={3} placeholder="Pega aquí el respaldo JSON" value={txt} onChange={e => setTxt(e.target.value)} />
          <button className="btn s" style={{ marginTop: 6 }} onClick={importar}>Importar</button>
        </>
      )}
    </>
  )
}

function Evolucion({ nid }) {
  const [dias, setDias] = useState(null)
  const [comp, setComp] = useState([])
  const [prod, setProd] = useState([])
  useEffect(() => {
    (async () => {
      const [a, b, c] = await Promise.all([
        supabase.from('ventas_diarias').select('fecha,ventas,costo,ganancia').eq('negocio_id', nid).order('fecha').range(0, 4999),
        supabase.from('compras').select('fecha,monto').eq('negocio_id', nid).range(0, 4999),
        supabase.from('ventas_por_producto').select('producto,cantidad,venta,ganancia').eq('negocio_id', nid).range(0, 4999),
      ])
      setDias(a.data || []); setComp(b.data || []); setProd(c.data || [])
    })()
  }, [nid])
  if (!dias) return <p className="mu">Cargando…</p>
  if (!dias.length) return <div className="card">Aún no hay ventas. Corre historico.sql o registra ventas en la pestaña Vender.</div>

  const num = x => +x || 0
  const ini = weekStart(dias[0].fecha), fin = weekStart(dias[dias.length - 1].fecha)
  const sem = []
  for (let w = ini; w <= fin; w = addDays(w, 7)) sem.push({ w, v: 0, c: 0, g: 0, b: 0 })
  const idx = f => Math.round((new Date(weekStart(f) + 'T12:00:00') - new Date(ini + 'T12:00:00')) / 6048e5)
  dias.forEach(d => { const s = sem[idx(d.fecha)]; s.v += num(d.ventas); s.c += num(d.costo); s.g += num(d.ganancia) })
  comp.forEach(k => { const s = sem[idx(k.fecha)]; if (s) s.b += num(k.monto) })

  const TV = sem.reduce((t, s) => t + s.v, 0), TG = sem.reduce((t, s) => t + s.g, 0), TB = sem.reduce((t, s) => t + s.b, 0)
  const conVenta = dias.filter(d => num(d.ventas) > 0)
  const mejor = conVenta.reduce((m, d) => (num(d.ventas) > num(m.ventas) ? d : m), conVenta[0] || dias[0])

  const max = Math.max(...sem.map(s => s.v), 1)
  const bw = 16, gap = 14, H = 170, W = Math.max(320, sem.length * (2 * bw + gap) + 20)
  let acum = 0
  const pm = {}
  prod.forEach(p => {
    const m = pm[p.producto] || (pm[p.producto] = { n: p.producto, q: 0, v: 0, g: 0 })
    m.q += num(p.cantidad); m.v += num(p.venta); m.g += num(p.ganancia)
  })
  const top = Object.values(pm).sort((a, b) => b.g - a.g).slice(0, 12)
  const dow = DIAS.map((n, i) => {
    const ds = conVenta.filter(d => new Date(d.fecha + 'T12:00:00').getDay() === i)
    const v = ds.reduce((t, d) => t + num(d.ventas), 0), g = ds.reduce((t, d) => t + num(d.ganancia), 0)
    return { n, k: ds.length, pv: ds.length ? v / ds.length : 0, pg: ds.length ? g / ds.length : 0 }
  })
  const maxPv = Math.max(...dow.map(x => x.pv), 1)

  return (
    <>
      <div className="card">
        <b>Todo el negocio desde el inicio ({dias[0].fecha})</b>
        <div className="row"><span>Ventas</span><b>{$(TV)}</b></div>
        <div className="row"><span>Ganancia</span><b className="g">{$(TG)}</b></div>
        <div className="row"><span>Margen sobre ventas</span><b>{TV ? Math.round(TG / TV * 100) : 0}%</b></div>
        <div className="row"><span>Invertido en compras</span><b>{$(TB)}</b></div>
        <div className="row"><span>Días con venta</span><b>{conVenta.length}</b></div>
        <div className="row"><span>Promedio por día con venta</span><b>{$(TV / Math.max(conVenta.length, 1))}</b></div>
        <div className="row"><span>Mejor día ({mejor.fecha.slice(5)})</span><b>{$(mejor.ventas)}</b></div>
      </div>

      <h3>Por semana <span className="mu">(<span style={{ color: '#ffb703' }}>■</span> ventas · <span style={{ color: '#2b8a3e' }}>■</span> ganancia)</span></h3>
      <div className="wrap card">
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
          {sem.map((s, i) => {
            const x = 10 + i * (2 * bw + gap), hv = s.v / max * (H - 44), hg = Math.max(0, s.g) / max * (H - 44)
            return (
              <g key={s.w}>
                <rect x={x} y={H - 22 - hv} width={bw} height={hv} fill="#ffb703" />
                <rect x={x + bw} y={H - 22 - hg} width={bw} height={hg} fill="#2b8a3e" />
                <text x={x + bw} y={H - 25 - hv} fontSize="9" textAnchor="middle" fill="#6b6459">{(s.v / 1000).toFixed(1)}k</text>
                <text x={x + bw} y={H - 8} fontSize="9" textAnchor="middle" fill="#6b6459">{s.w.slice(8)}/{s.w.slice(5, 7)}</text>
              </g>
            )
          })}
        </svg>
      </div>
      <div className="wrap">
        <table>
          <thead><tr><th>Semana</th><th>Ventas</th><th>vs ant.</th><th>Ganancia</th><th>Acum.</th></tr></thead>
          <tbody>
            {sem.map((s, i) => {
              acum += s.g
              const p = sem[i - 1]
              return (
                <tr key={s.w}>
                  <td>{s.w.slice(5)}{s.w === weekStart(iso()) ? ' ●' : ''}</td><td>{$(s.v)}</td>
                  <td className={p && p.v ? (s.v >= p.v ? 'g' : 'bad') : ''}>{p && p.v ? `${s.v >= p.v ? '+' : ''}${Math.round((s.v - p.v) / p.v * 100)}%` : '–'}</td>
                  <td>{$(s.g)}</td><td>{$(acum)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mu">● = semana en curso (incompleta). La semana va de domingo a sábado.</p>

      <h3>Promedio por día de la semana</h3>
      <div className="wrap">
        <table>
          <thead><tr><th>Día</th><th>Días</th><th>Ventas prom.</th><th>Ganancia prom.</th></tr></thead>
          <tbody>
            {dow.map(x => (
              <tr key={x.n}>
                <td>{x.n}</td><td>{x.k}</td>
                <td>
                  <div style={{ display: 'inline-block', height: 8, borderRadius: 4, background: '#ffb703', width: Math.round(x.pv / maxPv * 60), marginRight: 6 }} />
                  {$(x.pv)}
                </td>
                <td>{$(x.pg)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mu">Solo cuenta días con ventas. Con pocos días de historial el promedio todavía es poco confiable.</p>

      <h3>Productos que más ganancia dejan</h3>
      <div className="wrap">
        <table>
          <thead><tr><th>Producto</th><th>Piezas</th><th>Ventas</th><th>Ganancia</th></tr></thead>
          <tbody>{top.map(p => <tr key={p.n}><td>{p.n}</td><td>{+p.q.toFixed(1)}</td><td>{$(p.v)}</td><td>{$(p.g)}</td></tr>)}</tbody>
        </table>
      </div>
    </>
  )
}

export default function App() {
  const [session, setSession] = useState(undefined)
  const [mem, setMem] = useState(null)
  const [tab, setTab] = useState('v')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])
  useEffect(() => {
    if (!session) { setMem(null); return }
    supabase.from('miembros').select('negocio_id,rol').limit(1).maybeSingle()
      .then(({ data }) => setMem(data || false))
  }, [session])

  if (session === undefined) return <main><p className="mu">Cargando…</p></main>
  if (!session) return <Login />
  if (mem === null) return <><Head /><main><p className="mu">Cargando…</p></main></>
  if (mem === false) return (
    <><Head out={() => supabase.auth.signOut()} />
      <main><div className="card">Tu usuario no está asignado a ningún negocio. Corre el seed.sql con tu correo.</div></main></>
  )
  return <Shell nid={mem.negocio_id} admin={['admin', 'socio'].includes(mem.rol)} tab={tab} setTab={setTab} />
}

function Shell({ nid, admin, tab, setTab }) {
  const [prods, reload] = useProductos(nid)
  const tabs = [['v', 'Vender'], ['s', 'Stock'], ['c', 'Compras'], ['x', 'Cierre'], ['e', 'Evolución']]
  return (
    <>
      <Head out={() => supabase.auth.signOut()} />
      <main>
        {tab === 'v' && <Vender nid={nid} prods={prods} reload={reload} />}
        {tab === 's' && <Stock nid={nid} prods={prods} reload={reload} admin={admin} />}
        {tab === 'c' && <Compras nid={nid} prods={prods} reload={reload} />}
        {tab === 'x' && <Cierre nid={nid} admin={admin} />}
        {tab === 'e' && <Evolucion nid={nid} />}
      </main>
      <nav>{tabs.map(([k, t]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t}</button>)}</nav>
    </>
  )
}
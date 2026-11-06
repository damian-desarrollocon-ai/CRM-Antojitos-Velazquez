import { useEffect, useState, useCallback } from 'react'
import { supabase } from './supabase'
import { $, iso, addDays, weekStart, DIAS, fail } from './lib'

export function Compras({ nid, prods, reload }) {
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

export function Cierre({ nid, admin }) {
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

export function Evolucion({ nid }) {
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

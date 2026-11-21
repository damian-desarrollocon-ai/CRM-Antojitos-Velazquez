import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from './supabase'
import { $, iso, addDays, weekStart, DIAS, fail } from './lib'

const N = x => +x || 0
const TIPOS = [
  ['reinversion', '🔁 Reinversión', 'Producto o insumos para vender (cocas, queso, botanas…)'],
  ['negocio', '🏪 Del negocio', 'Gas, hielo, bolsas, renta… para operar'],
  ['personal', '👤 Personal', 'Desayuno u otros gastos de los socios'],
]
const TIPO_TXT = { reinversion: '🔁 Reinversión', negocio: '🏪 Negocio', personal: '👤 Personal' }
const total = (arr, t) => arr.filter(c => c.tipo === t).reduce((s, c) => s + N(c.monto), 0)

/* Por producto: piezas, vendido, costo al vender, ganancia, cuánto cuesta reponerlo HOY y cuánto se compró. */
function desglose(filas, compras, prods) {
  const porId = new Map(prods.map(p => [p.id, p]))
  const porNombre = new Map(prods.map(p => [p.nombre, p]))
  const m = new Map()
  filas.forEach(r => {
    const p = (r.producto_id && porId.get(r.producto_id)) || porNombre.get(r.producto)
    const k = p ? p.id : 'n:' + r.producto
    const x = m.get(k) || { k, n: p ? p.nombre : r.producto, q: 0, v: 0, c: 0, act: p ? N(p.costo) : 0, cmp: 0, cmpq: 0 }
    x.q += N(r.cantidad); x.v += N(r.venta); x.c += N(r.costo)
    m.set(k, x)
  })
  compras.filter(c => c.tipo === 'reinversion' && c.producto_id).forEach(c => {
    const x = m.get(c.producto_id)
    if (x) { x.cmp += N(c.monto); x.cmpq += N(c.piezas) }
  })
  return [...m.values()].map(x => {
    const u = x.q ? x.c / x.q : 0                       // costo por pieza con el que se vendió
    const costoAct = x.act || u                         // costo por pieza para reponer hoy (si no hay costo, el de la venta)
    return { ...x, u, g: x.v - x.c, rep: x.q * costoAct, alza: x.act > 0 && u > 0 && x.act > u * 1.02, sinCosto: x.act === 0 && x.c === 0 }
  }).sort((a, b) => b.v - a.v)
}

/* ---------------- Compras y gastos ---------------- */
export function Compras({ nid, prods, reload, admin }) {
  const hoy = iso()
  const vacio = { tipo: 'reinversion', producto: '', insumo: '', monto: '', piezas: '', fecha: hoy }
  const [f, setF] = useState(vacio)
  const [aviso, setAviso] = useState(null)
  const [rango, setRango] = useState('hoy')
  const [filtro, setFiltro] = useState('todos')
  const [lista, setLista] = useState([])
  const desde = rango === 'hoy' ? hoy : rango === '7' ? addDays(hoy, -6) : hoy.slice(0, 8) + '01'

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.from('compras').select('id,fecha,insumo,monto,tipo,producto_id,piezas')
      .eq('negocio_id', nid).gte('fecha', desde).lte('fecha', hoy)
      .order('fecha', { ascending: false }).order('created_at', { ascending: false }).range(0, 999)
    if (!error) setLista(data || [])
  }, [nid, desde, hoy])
  useEffect(() => { cargar() }, [cargar])

  const esRe = f.tipo === 'reinversion'
  const p = esRe ? prods.find(x => x.id === f.producto) : null
  const monto = parseFloat(f.monto) || 0, piezas = parseFloat(f.piezas) || 0
  const unit = p && piezas > 0 && monto > 0 ? monto / piezas : 0
  const antes = p ? N(p.costo) : 0

  const guardar = async () => {
    if (!monto) return alert('Falta el monto')
    if (p && !piezas) return alert('Pon cuántas piezas entran, para calcular el costo por pieza y subir el stock.')
    const { error } = await supabase.rpc('registrar_compra', {
      p_negocio: nid, p_fecha: f.fecha, p_categoria: TIPO_TXT[f.tipo].replace(/^\S+\s/, ''),
      p_insumo: f.insumo.trim() || (p ? p.nombre : 'Gasto'), p_monto: monto,
      p_producto: p ? p.id : null, p_piezas: p ? piezas : 0, p_notas: null, p_tipo: f.tipo,
    })
    if (fail(error)) return
    setAviso(p && unit > 0 && antes > 0 && Math.abs(unit - antes) >= 0.01
      ? { nombre: p.nombre, antes, unit, precio: N(p.precio) } : null)
    setF({ ...vacio, tipo: f.tipo, fecha: f.fecha })
    cargar(); reload()
  }
  const cambiarTipo = async (c, tipo) => {
    const { error } = await supabase.from('compras').update({ tipo }).eq('id', c.id)
    if (!fail(error)) cargar()
  }

  const visibles = lista.filter(c => filtro === 'todos' || c.tipo === filtro)
  const grupos = []
  visibles.forEach(c => {
    let g = grupos[grupos.length - 1]
    if (!g || g.f !== c.fecha) { g = { f: c.fecha, rows: [] }; grupos.push(g) }
    g.rows.push(c)
  })
  const nombreProd = id => (prods.find(x => x.id === id) || {}).nombre

  return (
    <>
      <div className="card">
        <b>Registrar compra o gasto</b>
        <div className="seg">
          {TIPOS.map(([k, t]) => <button key={k} className={f.tipo === k ? 'on' : ''} onClick={() => setF({ ...f, tipo: k, producto: k === 'reinversion' ? f.producto : '', piezas: '' })}>{t}</button>)}
        </div>
        <p className="mu">{TIPOS.find(t => t[0] === f.tipo)[2]}</p>
        {esRe && (
          <select value={f.producto} onChange={e => setF({ ...f, producto: e.target.value, insumo: '' })}>
            <option value="">Otro insumo (queso, aceite… sin stock)</option>
            {prods.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}
          </select>
        )}
        <input placeholder={p ? 'Concepto (opcional)' : 'Concepto (ej. queso, hielo, desayuno)'} value={f.insumo} onChange={e => setF({ ...f, insumo: e.target.value })} />
        <div className="row2">
          <input type="number" inputMode="decimal" placeholder="Monto total $" value={f.monto} onChange={e => setF({ ...f, monto: e.target.value })} />
          {p && <input type="number" inputMode="decimal" placeholder="Piezas que entran" value={f.piezas} onChange={e => setF({ ...f, piezas: e.target.value })} />}
        </div>
        {unit > 0 && (
          <p className={'costoprev' + (antes > 0 && unit > antes + 0.009 ? ' alza' : '')}>
            = <b>{$(unit)}</b> por pieza
            {antes > 0 && <> · antes {$(antes)} ({unit >= antes ? '+' : '−'}{$(Math.abs(unit - antes))}) · tu ganancia por pieza pasa de {$(N(p.precio) - antes)} a {$(N(p.precio) - unit)}</>}
          </p>
        )}
        <input type="date" value={f.fecha} onChange={e => setF({ ...f, fecha: e.target.value })} />
        <button className="btn" onClick={guardar}>Guardar</button>
        {esRe && <p className="mu">Si eliges un producto, el stock sube y su costo se actualiza al último precio pagado. Eso mueve tu ganancia y cuánto debes reinvertir.</p>}
      </div>

      {aviso && (
        <div className={'card ' + (aviso.unit > aviso.antes ? 'warn' : 'okc')}>
          {aviso.unit > aviso.antes
            ? <>⚠️ <b>{aviso.nombre}</b> subió de {$(aviso.antes)} a {$(aviso.unit)} por pieza (+{$(aviso.unit - aviso.antes)}). Tu ganancia por pieza baja de {$(aviso.precio - aviso.antes)} a {$(aviso.precio - aviso.unit)}.</>
            : <>✅ <b>{aviso.nombre}</b> te costó menos: de {$(aviso.antes)} a {$(aviso.unit)} por pieza. Ahora ganas {$(aviso.precio - aviso.unit)} por pieza.</>}
        </div>
      )}

      <div className="chips">
        {[['hoy', 'Hoy'], ['7', 'Últimos 7 días'], ['mes', 'Este mes']].map(([k, t]) => <button key={k} className={rango === k ? 'on' : ''} onClick={() => setRango(k)}>{t}</button>)}
      </div>
      <div className="stats">
        {TIPOS.map(([k, t]) => <div className="stat" key={k}><span>{t}</span><b>{$(total(lista, k))}</b></div>)}
        <div className="stat hl"><span>Total gastado</span><b>{$(lista.reduce((s, c) => s + N(c.monto), 0))}</b></div>
      </div>
      <div className="chips">
        {[['todos', 'Todos'], ...TIPOS.map(([k, t]) => [k, t])].map(([k, t]) => <button key={k} className={filtro === k ? 'on' : ''} onClick={() => setFiltro(k)}>{t}</button>)}
      </div>
      {visibles.length === 0 && <p className="mu">Sin gastos en este periodo.</p>}
      {grupos.map(g => (
        <div key={g.f}>
          {rango !== 'hoy' && <h3 className="dayhead">{g.f}</h3>}
          {g.rows.map(c => (
            <div className="card vrow" key={c.id}>
              <div className="row">
                <div><b>{c.insumo}</b>
                  {c.producto_id && N(c.piezas) > 0 && <div className="mu">{nombreProd(c.producto_id) || 'Producto'} · {N(c.piezas)} pzs · {$(N(c.monto) / N(c.piezas))} c/u</div>}
                </div>
                <b className="amt">{$(c.monto)}</b>
              </div>
              {admin
                ? <select className="mini" value={c.tipo} onChange={e => cambiarTipo(c, e.target.value)} aria-label="Tipo de gasto">
                    {TIPOS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                  </select>
                : <span className="tag">{TIPO_TXT[c.tipo]}</span>}
            </div>
          ))}
        </div>
      ))}
    </>
  )
}

/* ---------------- Cierre del día y corte de la semana ---------------- */
export function Cierre({ nid, admin }) {
  const [d, setD] = useState(iso())
  const [pct, setPct] = useState(25)
  const [restarPersonal, setRestarPersonal] = useState(true)
  const [res, setRes] = useState([])
  const [com, setCom] = useState([])
  const [socios, setSocios] = useState([])
  const [pp, setPp] = useState([])
  const [prods, setProds] = useState([])
  const [txt, setTxt] = useState('')
  const w = weekStart(d)
  const dias = [...Array(7)].map((_, i) => addDays(w, i))

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const [a, b, c, e, f] = await Promise.all([
        supabase.from('ventas_diarias').select('fecha,ventas,costo,ganancia').eq('negocio_id', nid).gte('fecha', dias[0]).lte('fecha', dias[6]),
        supabase.from('compras').select('id,fecha,insumo,monto,tipo,producto_id,piezas').eq('negocio_id', nid).gte('fecha', dias[0]).lte('fecha', dias[6]).order('created_at'),
        supabase.from('socios').select('*').eq('negocio_id', nid).order('nombre'),
        supabase.from('ventas_producto_dia').select('fecha,producto_id,producto,cantidad,venta,costo').eq('negocio_id', nid).gte('fecha', dias[0]).lte('fecha', dias[6]).range(0, 4999),
        supabase.from('productos').select('id,nombre,precio,costo').eq('negocio_id', nid),
      ])
      if (!vivo) return
      setRes(a.data || []); setCom(b.data || []); setSocios(c.data || []); setPp(e.data || []); setProds(f.data || [])
    })()
    return () => { vivo = false }
  }, [nid, w])

  // ----- el día -----
  const dv = res.find(x => x.fecha === d) || {}
  const vendido = N(dv.ventas), costo = N(dv.costo), ganancia = N(dv.ganancia)
  const cd = com.filter(c => c.fecha === d)
  const reinv = total(cd, 'reinversion'), neg = total(cd, 'negocio'), per = total(cd, 'personal')
  const tabla = useMemo(() => desglose(pp.filter(r => r.fecha === d), cd, prods), [pp, com, prods, d])
  const reponer = tabla.length ? tabla.reduce((s, x) => s + x.rep, 0) : costo
  const costoTabla = tabla.length ? tabla.reduce((s, x) => s + x.c, 0) : costo
  const sobre = reponer - costoTabla
  const pendiente = reponer - reinv
  const gReal = vendido - reponer - neg
  const sinCosto = tabla.filter(x => x.sinCosto)

  // ----- la semana -----
  const sem = dias.map(x => {
    const r = res.find(y => y.fecha === x) || {}, cc = com.filter(c => c.fecha === x)
    return { v: N(r.ventas), g: N(r.ganancia), re: total(cc, 'reinversion'), ne: total(cc, 'negocio'), pe: total(cc, 'personal') }
  })
  const S = f => sem.reduce((t, x) => t + f(x), 0)
  const tv = S(x => x.v), gan = S(x => x.g), reW = S(x => x.re), neW = S(x => x.ne), peW = S(x => x.pe)
  const tablaSem = useMemo(() => desglose(pp, com, prods), [pp, com, prods])
  const reponerW = tablaSem.length ? tablaSem.reduce((s, x) => s + x.rep, 0) : tv - gan
  const sobreW = tablaSem.length ? reponerW - tablaSem.reduce((s, x) => s + x.c, 0) : 0
  const gRealW = tv - reponerW - neW
  const crecer = Math.max(gRealW, 0) * pct / 100
  const descPer = restarPersonal ? peW : 0
  const repartir = gRealW - crecer - descPer

  const guardarCorte = async () => {
    const { error } = await supabase.from('cortes').upsert({
      negocio_id: nid, semana_inicio: w, ventas: tv, costo: tv - gRealW, ganancia: gRealW, pct_reinversion: pct, reinversion: crecer, repartir,
      reparto: socios.map(s => ({ socio: s.nombre, monto: +(repartir * s.porcentaje / 100).toFixed(2) })),
      detalle: { ganancia_bruta: gan, sobrecosto: sobreW, gastos_negocio: neW, gastos_personales: peW, personal_descontado: restarPersonal, reinversion_compras: reW },
    }, { onConflict: 'negocio_id,semana_inicio' })
    if (!fail(error)) alert('Corte guardado')
  }
  const importar = async () => {
    let data
    try { data = JSON.parse(txt) } catch { return alert('Respaldo no válido') }
    const { data: r, error } = await supabase.rpc('importar_respaldo_v1', { p_negocio: nid, p_data: data })
    if (!fail(error)) alert(`Importado: ${r.productos} productos, ${r.ventas} ventas, ${r.compras} compras. Recarga la página.`)
  }

  const porTipo = [['reinversion', reinv], ['negocio', neg], ['personal', per]]
  return (
    <>
      <input type="date" value={d} onChange={e => setD(e.target.value)} />

      <div className="card">
        <div className="row"><span>Vendido</span><b>{$(vendido)}</b></div>
        <div className="row"><span>Costo de lo vendido</span><b>−{$(costo)}</b></div>
        <div className="row tot"><span>Ganancia</span><b className="g">{$(ganancia)}</b></div>
      </div>

      <div className="card">
        <b>Dónde se fue el dinero</b>
        {porTipo.map(([k, v]) => <div className="row" key={k}><span>{TIPO_TXT[k]}</span><b>{$(v)}</b></div>)}
        <div className="row tot"><span>Total gastado</span><b>{$(reinv + neg + per)}</b></div>
        {cd.length > 0 && (
          <details>
            <summary className="mu">Ver cada gasto</summary>
            {TIPOS.map(([k, t]) => cd.filter(c => c.tipo === k).length > 0 && (
              <div key={k}><p className="mu" style={{ margin: '8px 0 2px' }}><b>{t}</b></p>
                {cd.filter(c => c.tipo === k).map(c => <div className="row" key={c.id}><span>{c.insumo}</span><span>{$(c.monto)}</span></div>)}</div>
            ))}
          </details>
        )}
      </div>

      <div className="card hl">
        <b>¿Cuánto reinvertir hoy?</b>
        <div className="row"><span>Reponer lo vendido (a costo de hoy)</span><b>{$(reponer)}</b></div>
        <div className="row"><span>Ya reinvertido</span><b>{$(reinv)}</b></div>
        {pendiente > 0.5
          ? <div className="row tot"><span>Faltan por reinvertir</span><b>{$(pendiente)}</b></div>
          : <div className="row tot"><span>Reinvertiste de más</span><b>{$(-pendiente)}</b></div>}
        {pendiente <= 0.5 && <p className="mu">Esa diferencia se queda como inventario.</p>}
        {sobre > 0.5 && <p className="alza2">⚠ Reponer cuesta {$(sobre)} más que el costo con el que vendiste: algunos productos subieron de precio.</p>}
        <div className="row tot"><span>Ganancia real</span><b>{$(gReal)}</b></div>
        <p className="mu">Vendido − reponer a costo de hoy − gastos del negocio. Los gastos personales no cuentan aquí.</p>
        {per > 0 && <p className="mu">👤 Personales de hoy: {$(per)} (salen de la caja pero no son del negocio).</p>}
      </div>

      <h3>Cada producto: costo, ganancia y qué reinvertir</h3>
      {tabla.length === 0 && <p className="mu">Sin ventas con detalle este día.</p>}
      {tabla.length > 0 && (
        <div className="wrap card flush tight">
          <table>
            <thead><tr><th>Producto</th><th>Pzs</th><th>Vendido</th><th>Costo</th><th>Ganancia</th><th>Reinvertir</th><th>Comprado</th></tr></thead>
            <tbody>
              {tabla.map(x => (
                <tr key={x.k}>
                  <td>{x.n}
                    {x.alza && <div className="alza2">⚠ costo {$(x.u)} → {$(x.act)} c/u</div>}
                    {x.sinCosto && <div className="alza2">⚠ sin costo capturado</div>}
                  </td>
                  <td>{+x.q.toFixed(2)}</td><td>{$(x.v)}</td><td>{$(x.c)}</td>
                  <td className={x.g < 0 ? 'bad' : 'g'}>{$(x.g)}</td><td><b>{$(x.rep)}</b></td><td>{x.cmp ? $(x.cmp) : '–'}</td>
                </tr>
              ))}
              <tr><th>Total</th><th>{+tabla.reduce((t, x) => t + x.q, 0).toFixed(2)}</th><th>{$(tabla.reduce((t, x) => t + x.v, 0))}</th><th>{$(costoTabla)}</th><th>{$(tabla.reduce((t, x) => t + x.g, 0))}</th><th>{$(reponer)}</th><th>{$(tabla.reduce((t, x) => t + x.cmp, 0))}</th></tr>
            </tbody>
          </table>
          <p className="mu" style={{ padding: '0 8px' }}>
            <b>Reinvertir</b> = piezas vendidas × costo actual de cada producto (el último precio que pagaste). <b>Comprado</b> = lo que compraste hoy de ese producto.
            Importes a precio de lista, antes de descuentos.
          </p>
        </div>
      )}
      {sinCosto.length > 0 && <p className="alza2">Captura el costo de: {sinCosto.map(x => x.n).join(', ')}. Sin costo, la ganancia sale inflada.</p>}

      <h3>Semana (dom–sáb)</h3>
      <div className="wrap">
        <table>
          <thead><tr><th>Día</th><th>Ventas</th><th>Ganancia</th><th>Reinv.</th><th>Negocio</th><th>Personal</th></tr></thead>
          <tbody>
            {sem.map((x, i) => <tr key={i}><td>{DIAS[i]} {dias[i].slice(8)}</td><td>{$(x.v)}</td><td>{$(x.g)}</td><td>{$(x.re)}</td><td>{$(x.ne)}</td><td>{$(x.pe)}</td></tr>)}
            <tr><th>Total</th><th>{$(tv)}</th><th>{$(gan)}</th><th>{$(reW)}</th><th>{$(neW)}</th><th>{$(peW)}</th></tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <b>Corte del sábado</b>
        <div className="row"><span>Ganancia (precio − costo registrado)</span><b>{$(gan)}</b></div>
        {sobreW > 0.5 && <div className="row"><span>− Sobrecosto por alzas de precio</span><b>−{$(sobreW)}</b></div>}
        <div className="row"><span>− Gastos del negocio</span><b>−{$(neW)}</b></div>
        <div className="row tot"><span>Ganancia real</span><b>{$(gRealW)}</b></div>
        <div className="row"><span>% para crecer</span><input className="n" type="number" value={pct} onChange={e => setPct(parseFloat(e.target.value) || 0)} /></div>
        <div className="row"><span>− Para crecer</span><b>−{$(crecer)}</b></div>
        <label className="chk"><input type="checkbox" checked={restarPersonal} onChange={e => setRestarPersonal(e.target.checked)} /> Restar gastos personales de la semana ({$(peW)})</label>
        <div className="row tot"><span>A repartir</span><b className="g">{$(repartir)}</b></div>
        {socios.map(s => <div className="row" key={s.id}><span>{s.nombre} ({+s.porcentaje}%)</span><b className="g">{$(repartir * s.porcentaje / 100)}</b></div>)}
        {admin && <button className="btn" onClick={guardarCorte}>Guardar corte</button>}
        <p className="mu">La ganancia real descuenta lo que cuesta reponer a precios de hoy y los gastos del negocio. Si un costo está en 0, la ganancia sale inflada.</p>
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
        supabase.from('compras').select('fecha,monto,tipo').eq('negocio_id', nid).range(0, 4999),
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
  comp.forEach(k => { const s = sem[idx(k.fecha)]; if (s && k.tipo === 'reinversion') s.b += num(k.monto) })
  const TN = comp.filter(k => k.tipo === 'negocio').reduce((t, k) => t + num(k.monto), 0)
  const TP = comp.filter(k => k.tipo === 'personal').reduce((t, k) => t + num(k.monto), 0)

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
        <div className="row"><span>Reinvertido en producto</span><b>{$(TB)}</b></div>
        <div className="row"><span>Gastos del negocio</span><b>{$(TN)}</b></div>
        <div className="row"><span>Gastos personales</span><b>{$(TP)}</b></div>
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

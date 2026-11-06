import { lazy, Suspense } from 'react'
import Store from './Store.jsx'

// El punto de venta se carga aparte para que la tienda del cliente abra rápido.
const Pos = lazy(() => import('./Pos.jsx'))

export default function App() {
  const p = window.location.pathname
  if (p.startsWith('/pos')) return <Suspense fallback={<p style={{ padding: 20 }}>Cargando…</p>}><Pos /></Suspense>
  const m = p.match(/^\/pedido\/([A-Za-z0-9-]+)/)
  return <Store codigo={m ? m[1].toUpperCase() : null} />
}

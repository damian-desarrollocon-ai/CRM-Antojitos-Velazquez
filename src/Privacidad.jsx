import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import './store.css'

export default function Privacidad() {
  const [t, setT] = useState(null)
  useEffect(() => { supabase.from('tienda_publica').select('*').limit(1).maybeSingle().then(({ data }) => setT(data)) }, [])
  const nombre = t?.nombre || 'Antojitos Velázquez'
  const wa = t?.whatsapp

  return (
    <div className="st">
      <header className="st-top">
        <a className="st-brand" href="/"><img src="/logo.jpg" alt="" /><span>Antojitos <b>Velázquez</b></span></a>
      </header>
      <article className="st-legal">
        <h1>Aviso de privacidad</h1>
        <p className="st-fine">Última actualización: 6 de noviembre de 2026</p>

        <h2>Quiénes somos</h2>
        <p>{nombre} es el responsable de los datos personales que nos compartes al hacer un pedido en esta página o en nuestra app.
          {t?.direccion ? ` Estamos en ${t.direccion}.` : ''}</p>

        <h2>Qué datos recabamos</h2>
        <ul>
          <li>Nombre y número de teléfono o WhatsApp.</li>
          <li>Dirección de entrega y referencias (solo si pides a domicilio).</li>
          <li>El contenido de tu pedido, tus notas y el método de pago que elegiste.</li>
        </ul>
        <p>No pedimos ni guardamos datos de tarjetas. El pago se hace en efectivo, por transferencia o con terminal al momento de la entrega.</p>

        <h2>Para qué los usamos</h2>
        <ul>
          <li>Preparar tu pedido, entregarlo y contactarte si hay algún detalle.</li>
          <li>Mostrarte el seguimiento de tu pedido.</li>
          <li>Llevar el control interno de ventas del negocio.</li>
        </ul>
        <p>No vendemos tus datos ni los usamos para publicidad de terceros.</p>

        <h2>Con quién se comparten</h2>
        <p>Solo con los proveedores técnicos que hacen funcionar el servicio (alojamiento de la página y de la base de datos), que los tratan únicamente
          para ese fin, y con quien reparte tu pedido, si aplica.</p>

        <h2>Datos guardados en tu dispositivo</h2>
        <p>Para tu comodidad guardamos en tu dispositivo tu carrito, tus datos de contacto para autocompletar y el código de tu último pedido.
          Puedes borrarlos limpiando los datos del navegador o desinstalando la app.</p>

        <h2>Cuánto tiempo los conservamos</h2>
        <p>Guardamos tus pedidos el tiempo necesario para operar el negocio y cumplir obligaciones contables y fiscales.</p>

        <h2>Tus derechos y cómo borrar tus datos</h2>
        <p>Puedes pedirnos acceder a tus datos, corregirlos, que los eliminemos o que dejemos de usarlos. Escríbenos
          {wa ? <> por WhatsApp al <a href={'https://wa.me/' + wa}>+{wa}</a></> : ' por WhatsApp'} con tu nombre y el teléfono con el que hiciste tu pedido,
          y atenderemos tu solicitud a la brevedad.</p>

        <h2>Cambios a este aviso</h2>
        <p>Si lo actualizamos, publicaremos la nueva versión en esta misma página.</p>
        <p><a className="st-cta" href="/">Volver al menú</a></p>
      </article>
    </div>
  )
}

# Antojitos Velázquez · Punto de venta (React + Supabase)

## 1. Supabase
1. Crea un proyecto en supabase.com.
2. **SQL Editor** → pega `supabase/schema.sql` → Run.
3. **Authentication → Users → Add user**: crea tu usuario (correo + contraseña) y el de tus socios/vendedores.
   En **Authentication → Sign In / Providers** desactiva "Allow new users to sign up" para que nadie más pueda registrarse.
4. Abre `supabase/seed.sql`, cambia `TU_CORREO@EJEMPLO.COM` (y los correos de socios, descomentando) y los nombres de los 3 socios → Run.
   Carga productos, recetas e historial de compras de tu Excel.

## 2. Claves (.env)
En Supabase → **Project Settings → API** copia *Project URL* y *anon public key* a `.env`:

    VITE_SUPABASE_URL=https://xxxx.supabase.co
    VITE_SUPABASE_ANON_KEY=eyJ...

Nunca pongas la `service_role` key en el frontend.

## 3. Correr
    npm install
    npm run dev        # desarrollo
    npm run build      # producción (carpeta dist/)

Para publicarlo: Vercel o Netlify (agrega las dos variables VITE_ en su panel de Environment Variables).

## 4. Pasar lo que ya capturaste en el POS v1
En el POS v1: Cierre → "Generar" → copia el texto. En la app nueva: Cierre → "Importar respaldo" → pega → Importar.
Trae productos (precio, costo y stock actuales), ventas y compras. Solo se puede una vez.

## Roles
- `admin` / `socio`: todo (editar precios, costos, corte, importar).
- `vendedor`: vender, anular, registrar compras y ver stock.

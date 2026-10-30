-- =====================================================================
-- Antojitos Velázquez · esquema Supabase
-- Pégalo completo en Supabase → SQL Editor → Run (una sola vez)
-- =====================================================================

-- ---------- Tablas ----------
create table negocios (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  created_at timestamptz not null default now()
);

create table miembros (
  negocio_id uuid not null references negocios(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rol text not null default 'vendedor' check (rol in ('admin','socio','vendedor')),
  primary key (negocio_id, user_id)
);

create table socios (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios(id) on delete cascade,
  nombre text not null,
  porcentaje numeric(5,2) not null default 33.33
);

create table productos (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios(id) on delete cascade,
  nombre text not null,
  categoria text not null default 'Otros',
  precio numeric(10,2) not null default 0,
  costo numeric(10,2) not null default 0,
  stock numeric(10,2) not null default 0,      -- en piezas vendibles; puede quedar negativo si vendes sin capturar
  stock_min numeric(10,2) not null default 5,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (negocio_id, nombre)
);

create table ventas (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios(id) on delete cascade,
  fecha date not null default (now() at time zone 'America/Mexico_City')::date,
  creada_at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  total numeric(12,2) not null default 0,
  costo_total numeric(12,2) not null default 0,
  metodo_pago text not null default 'efectivo',
  estado text not null default 'activa' check (estado in ('activa','anulada')),
  origen text not null default 'app'            -- 'v1' = importada del POS anterior
);

create table venta_items (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references ventas(id) on delete cascade,
  negocio_id uuid not null references negocios(id) on delete cascade,
  producto_id uuid references productos(id) on delete set null,
  nombre text not null,
  cantidad numeric(10,2) not null,
  precio numeric(10,2) not null,                -- precio y costo "congelados" al momento de la venta
  costo numeric(10,2) not null default 0
);

create table compras (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios(id) on delete cascade,
  fecha date not null default (now() at time zone 'America/Mexico_City')::date,
  categoria text not null default 'General',
  insumo text not null,
  cantidad numeric(12,3),
  unidad text,
  monto numeric(12,2) not null,
  producto_id uuid references productos(id) on delete set null,
  piezas numeric(10,2) not null default 0,      -- piezas que entraron a stock
  notas text,
  user_id uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table movimientos_stock (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios(id) on delete cascade,
  producto_id uuid not null references productos(id) on delete cascade,
  delta numeric(10,2) not null,
  motivo text not null check (motivo in ('venta','anulacion','compra','ajuste')),
  ref uuid,
  user_id uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table recetas (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios(id) on delete cascade,
  producto_id uuid references productos(id) on delete cascade,
  producto_nombre text not null,
  insumo text not null,
  cantidad numeric(12,3),
  unidad text,
  costo_unidad numeric(12,4),
  notas text
);

create table cortes (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios(id) on delete cascade,
  semana_inicio date not null,
  ventas numeric(12,2) not null,
  costo numeric(12,2) not null,
  ganancia numeric(12,2) not null,
  pct_reinversion numeric(5,2) not null,
  reinversion numeric(12,2) not null,
  repartir numeric(12,2) not null,
  reparto jsonb not null default '[]',
  creado_at timestamptz not null default now(),
  unique (negocio_id, semana_inicio)
);

create index on ventas (negocio_id, fecha);
create index on venta_items (venta_id);
create index on compras (negocio_id, fecha);
create index on movimientos_stock (producto_id);

-- ---------- Permisos (RLS) ----------
create or replace function es_miembro(n uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from miembros where negocio_id = n and user_id = auth.uid())
$$;

create or replace function es_admin(n uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from miembros where negocio_id = n and user_id = auth.uid() and rol in ('admin','socio'))
$$;

alter table negocios enable row level security;
alter table miembros enable row level security;
create policy negocios_sel on negocios for select using (es_miembro(id));
create policy miembros_sel on miembros for select using (user_id = auth.uid());

do $$
declare t text;
begin
  -- todos los miembros pueden LEER
  foreach t in array array['socios','productos','ventas','venta_items','compras','movimientos_stock','recetas','cortes'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (es_miembro(negocio_id))', t || '_sel', t);
  end loop;
  -- solo admin/socio puede ESCRIBIR directo (las ventas y compras de los vendedores pasan por las funciones de abajo)
  foreach t in array array['socios','productos','compras','recetas','cortes'] loop
    execute format('create policy %I on %I for all using (es_admin(negocio_id)) with check (es_admin(negocio_id))', t || '_adm', t);
  end loop;
end $$;

-- ---------- Funciones del negocio ----------
create or replace function registrar_venta(p_negocio uuid, p_items jsonb, p_metodo text default 'efectivo')
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; it jsonb; p productos%rowtype; c numeric; tot numeric := 0; ctot numeric := 0;
begin
  if not es_miembro(p_negocio) then raise exception 'Sin acceso a este negocio'; end if;
  insert into ventas (negocio_id, metodo_pago) values (p_negocio, p_metodo) returning id into v;
  for it in select * from jsonb_array_elements(p_items) loop
    c := (it->>'cantidad')::numeric;
    select * into p from productos where id = (it->>'producto_id')::uuid and negocio_id = p_negocio for update;
    if not found then raise exception 'Producto inválido'; end if;
    insert into venta_items (venta_id, negocio_id, producto_id, nombre, cantidad, precio, costo)
      values (v, p_negocio, p.id, p.nombre, c, p.precio, p.costo);
    update productos set stock = stock - c where id = p.id;
    insert into movimientos_stock (negocio_id, producto_id, delta, motivo, ref) values (p_negocio, p.id, -c, 'venta', v);
    tot := tot + c * p.precio;
    ctot := ctot + c * p.costo;
  end loop;
  update ventas set total = tot, costo_total = ctot where id = v;
  return v;
end $$;

create or replace function anular_venta(p_venta uuid) returns void
language plpgsql security definer set search_path = public as $$
declare vt ventas%rowtype; i venta_items%rowtype;
begin
  select * into vt from ventas where id = p_venta for update;
  if not found or not es_miembro(vt.negocio_id) then raise exception 'Sin acceso'; end if;
  if vt.estado = 'anulada' then return; end if;
  for i in select * from venta_items where venta_id = p_venta loop
    if i.producto_id is not null then
      update productos set stock = stock + i.cantidad where id = i.producto_id;
      insert into movimientos_stock (negocio_id, producto_id, delta, motivo, ref) values (vt.negocio_id, i.producto_id, i.cantidad, 'anulacion', p_venta);
    end if;
  end loop;
  update ventas set estado = 'anulada' where id = p_venta;
end $$;

create or replace function registrar_compra(
  p_negocio uuid, p_fecha date, p_categoria text, p_insumo text, p_monto numeric,
  p_producto uuid default null, p_piezas numeric default 0, p_notas text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if not es_miembro(p_negocio) then raise exception 'Sin acceso a este negocio'; end if;
  insert into compras (negocio_id, fecha, categoria, insumo, monto, producto_id, piezas, notas)
    values (p_negocio, coalesce(p_fecha, (now() at time zone 'America/Mexico_City')::date), coalesce(p_categoria,'General'), p_insumo, p_monto, p_producto, coalesce(p_piezas,0), p_notas)
    returning id into cid;
  if p_producto is not null and coalesce(p_piezas,0) > 0 then
    update productos set stock = stock + p_piezas, costo = round(p_monto / p_piezas, 2)
      where id = p_producto and negocio_id = p_negocio;
    insert into movimientos_stock (negocio_id, producto_id, delta, motivo, ref) values (p_negocio, p_producto, p_piezas, 'compra', cid);
  end if;
  return cid;
end $$;

create or replace function ajustar_stock(p_producto uuid, p_nuevo numeric) returns void
language plpgsql security definer set search_path = public as $$
declare p productos%rowtype;
begin
  select * into p from productos where id = p_producto for update;
  if not found or not es_miembro(p.negocio_id) then raise exception 'Sin acceso'; end if;
  update productos set stock = p_nuevo where id = p_producto;
  insert into movimientos_stock (negocio_id, producto_id, delta, motivo) values (p.negocio_id, p.id, p_nuevo - p.stock, 'ajuste');
end $$;

-- Importa el respaldo JSON del POS versión 1 (botón "Generar" en Cierre).
-- Actualiza productos por nombre (precio, costo, stock) y trae ventas y compras. Solo se puede una vez.
create or replace function importar_respaldo_v1(p_negocio uuid, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; g record; v uuid; np int := 0; ns int := 0; nb int := 0;
begin
  if not es_admin(p_negocio) then raise exception 'Solo admin/socio puede importar'; end if;
  if exists (select 1 from ventas where negocio_id = p_negocio and origen = 'v1') then
    raise exception 'Ya se importó un respaldo antes';
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_data->'prods','[]')) loop
    insert into productos (negocio_id, nombre, precio, costo, stock, stock_min)
      values (p_negocio, r->>'n', coalesce((r->>'p')::numeric,0), coalesce((r->>'c')::numeric,0), coalesce((r->>'s')::numeric,0), coalesce((r->>'min')::numeric,5))
    on conflict (negocio_id, nombre) do update
      set precio = excluded.precio, costo = excluded.costo, stock = excluded.stock, stock_min = excluded.stock_min;
    np := np + 1;
  end loop;
  for g in select s->>'g' as gid, min(s->>'d') as d, min((s->>'t')::bigint) as t
           from jsonb_array_elements(coalesce(p_data->'sales','[]')) s group by 1 loop
    insert into ventas (negocio_id, fecha, creada_at, origen) values (p_negocio, g.d::date, to_timestamp(g.t / 1000.0), 'v1') returning id into v;
    insert into venta_items (venta_id, negocio_id, producto_id, nombre, cantidad, precio, costo)
      select v, p_negocio, (select id from productos where negocio_id = p_negocio and nombre = s->>'n'),
             s->>'n', (s->>'q')::numeric, (s->>'p')::numeric, (s->>'c')::numeric
      from jsonb_array_elements(p_data->'sales') s where s->>'g' = g.gid;
    update ventas set total = (select coalesce(sum(cantidad * precio),0) from venta_items where venta_id = v),
                      costo_total = (select coalesce(sum(cantidad * costo),0) from venta_items where venta_id = v)
      where id = v;
    ns := ns + 1;
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p_data->'buys','[]')) loop
    insert into compras (negocio_id, fecha, categoria, insumo, monto, notas)
      values (p_negocio, (r->>'d')::date, 'Importada v1', coalesce(nullif(r->>'n',''),'Gasto'), (r->>'m')::numeric, 'Importada del POS v1');
    nb := nb + 1;
  end loop;
  return jsonb_build_object('productos', np, 'ventas', ns, 'compras', nb);
end $$;

-- ---------- Vista para el cierre ----------
create view resumen_diario with (security_invoker = true) as
select negocio_id, fecha, count(*) as ventas_n, sum(total) as ventas, sum(costo_total) as costo, sum(total - costo_total) as ganancia
from ventas where estado = 'activa' group by negocio_id, fecha;

-- Tiempo real para que los 3 socios vean el stock al instante
do $$ begin alter publication supabase_realtime add table productos; exception when others then null; end $$;

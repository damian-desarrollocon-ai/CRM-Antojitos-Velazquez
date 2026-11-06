-- =====================================================================
-- Antojitos Velázquez · POS avanzado + tienda en línea
-- Correr UNA vez en Supabase → SQL Editor (después de schema, seed e historico).
-- =====================================================================

-- ---------- Productos: datos para la tienda en línea ----------
alter table productos
  add column if not exists descripcion text,
  add column if not exists imagen_url text,
  add column if not exists en_linea boolean not null default true,
  add column if not exists destacado boolean not null default false;

update productos set en_linea = false where categoria in ('Cigarros', 'Otros');
update productos set destacado = true, descripcion = 'Doritos preparados con cueritos, gomitas, pepino, jícama, chamoy, salsa botanera, cacahuate y tajín.' where nombre = 'Dorilocos';
update productos set destacado = true, descripcion = 'Chicharrón preparado con crema, col, cueritos, aguacate, jitomate, salsa botanera y tajín.' where nombre = 'Chicharrón preparado';
update productos set destacado = true, descripcion = 'Chilaquiles recién hechos.' where nombre = 'Chilaquiles';
update productos set descripcion = 'Café caliente.' where nombre = 'Café';
update productos set descripcion = 'Comida del día.' where nombre = 'Comida corrida';

-- ---------- Configuración de la tienda ----------
create table if not exists tienda (
  negocio_id uuid primary key references negocios(id) on delete cascade,
  nombre text not null default 'Antojitos Velázquez',
  slogan text default 'Dorilocos · Comidas · Desayunos · Cocas · Aguas · Dulces',
  whatsapp text default '525537750517',            -- solo dígitos, con 52
  abierto boolean not null default true,
  acepta_domicilio boolean not null default true,
  acepta_recoger boolean not null default true,
  costo_envio numeric(8,2) not null default 20,
  pedido_minimo numeric(8,2) not null default 50,
  envio_gratis_desde numeric(8,2),
  tiempo_estimado text default '25–40 min',
  zona text,
  horario text,
  direccion text
);

-- ---------- Caja (turnos) ----------
create table if not exists caja_turnos (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios(id) on delete cascade,
  abierta_at timestamptz not null default now(),
  abierta_por uuid default auth.uid(),
  fondo numeric(12,2) not null default 0,
  cerrada_at timestamptz,
  esperado numeric(12,2),
  contado numeric(12,2),
  diferencia numeric(12,2),
  notas text
);
create table if not exists caja_movimientos (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios(id) on delete cascade,
  turno_id uuid not null references caja_turnos(id) on delete cascade,
  tipo text not null check (tipo in ('ingreso', 'retiro')),
  monto numeric(12,2) not null check (monto > 0),
  concepto text,
  created_at timestamptz not null default now(),
  user_id uuid default auth.uid()
);

-- ---------- Ventas: descuento, pago, nota, turno ----------
alter table ventas
  add column if not exists descuento numeric(12,2) not null default 0,
  add column if not exists pago_con numeric(12,2),
  add column if not exists cambio numeric(12,2),
  add column if not exists nota text,
  add column if not exists cliente text,
  add column if not exists turno_id uuid references caja_turnos(id) on delete set null;

-- ---------- Pedidos en línea ----------
create table if not exists pedidos (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios(id) on delete cascade,
  codigo text not null unique,
  creado_at timestamptz not null default now(),
  actualizado_at timestamptz not null default now(),
  estado text not null default 'nuevo' check (estado in ('nuevo', 'preparando', 'listo', 'entregado', 'cancelado')),
  tipo text not null check (tipo in ('domicilio', 'recoger')),
  cliente text not null,
  telefono text not null,
  direccion text,
  referencias text,
  metodo_pago text not null default 'efectivo' check (metodo_pago in ('efectivo', 'transferencia', 'tarjeta')),
  paga_con numeric(10,2),
  notas text,
  subtotal numeric(12,2) not null default 0,
  envio numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  venta_id uuid references ventas(id) on delete set null
);
create table if not exists pedido_items (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references pedidos(id) on delete cascade,
  negocio_id uuid not null references negocios(id) on delete cascade,
  producto_id uuid references productos(id) on delete set null,
  nombre text not null,
  cantidad numeric(10,2) not null,
  precio numeric(10,2) not null
);
create index if not exists pedidos_idx on pedidos (negocio_id, estado, creado_at desc);
create index if not exists pedido_items_idx on pedido_items (pedido_id);

-- ---------- Permisos ----------
do $$
declare t text;
begin
  foreach t in array array['tienda', 'caja_turnos', 'caja_movimientos', 'pedidos', 'pedido_items'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_sel', t);
    execute format('create policy %I on %I for select using (es_miembro(negocio_id))', t || '_sel', t);
  end loop;
end $$;
drop policy if exists tienda_adm on tienda;
create policy tienda_adm on tienda for all using (es_admin(negocio_id)) with check (es_admin(negocio_id));

-- Vistas PÚBLICAS para la tienda (no exponen costos ni stock ni datos de clientes)
create or replace view catalogo as
select id, negocio_id, nombre, categoria, precio, descripcion, imagen_url, destacado
from productos where activo and en_linea;

create or replace view tienda_publica as
select negocio_id, nombre, slogan, whatsapp, abierto, acepta_domicilio, acepta_recoger, costo_envio,
       pedido_minimo, envio_gratis_desde, tiempo_estimado, zona, horario, direccion
from tienda;

grant select on catalogo, tienda_publica to anon, authenticated;

-- ---------- Venta con descuento, método de pago, cambio y turno de caja ----------
drop function if exists registrar_venta(uuid, jsonb, text);
create or replace function registrar_venta(
  p_negocio uuid, p_items jsonb, p_metodo text default 'efectivo',
  p_descuento numeric default 0, p_pago_con numeric default null, p_nota text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; it jsonb; p productos%rowtype; c numeric; tot numeric := 0; ctot numeric := 0; tid uuid; neto numeric;
begin
  if not es_miembro(p_negocio) then raise exception 'Sin acceso a este negocio'; end if;
  if p_metodo not in ('efectivo', 'transferencia', 'tarjeta') then raise exception 'Método de pago inválido'; end if;
  select id into tid from caja_turnos where negocio_id = p_negocio and cerrada_at is null order by abierta_at desc limit 1;
  insert into ventas (negocio_id, metodo_pago, nota, turno_id) values (p_negocio, p_metodo, p_nota, tid) returning id into v;
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
  if coalesce(p_descuento, 0) < 0 or coalesce(p_descuento, 0) > tot then raise exception 'Descuento inválido'; end if;
  neto := tot - coalesce(p_descuento, 0);
  update ventas set total = neto, costo_total = ctot, descuento = coalesce(p_descuento, 0), pago_con = p_pago_con,
    cambio = case when p_metodo = 'efectivo' and p_pago_con is not null then greatest(p_pago_con - neto, 0) end
  where id = v;
  return v;
end $$;

-- ---------- Pedidos en línea ----------
create or replace function crear_pedido(
  p_negocio uuid, p_cliente text, p_telefono text, p_tipo text, p_direccion text, p_referencias text,
  p_metodo text, p_paga_con numeric, p_notas text, p_items jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare t tienda%rowtype; it jsonb; p productos%rowtype; c numeric; sub numeric := 0; env numeric := 0;
        pid uuid; cod text; tel text; nom text;
begin
  select * into t from tienda where negocio_id = p_negocio;
  if not found or not t.abierto then raise exception 'La tienda no está recibiendo pedidos en este momento'; end if;
  nom := btrim(coalesce(p_cliente, ''));
  tel := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
  if length(nom) < 2 or length(nom) > 60 then raise exception 'Escribe tu nombre'; end if;
  if length(tel) < 10 or length(tel) > 13 then raise exception 'Escribe un teléfono válido de 10 dígitos'; end if;
  if p_tipo not in ('domicilio', 'recoger') then raise exception 'Tipo de entrega inválido'; end if;
  if p_tipo = 'domicilio' and (not t.acepta_domicilio or length(btrim(coalesce(p_direccion, ''))) < 6) then
    raise exception 'Escribe tu dirección de entrega';
  end if;
  if p_tipo = 'recoger' and not t.acepta_recoger then raise exception 'Por ahora solo entregamos a domicilio'; end if;
  if p_metodo not in ('efectivo', 'transferencia', 'tarjeta') then raise exception 'Método de pago inválido'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 40 then
    raise exception 'Tu pedido está vacío';
  end if;
  if (select count(*) from pedidos where negocio_id = p_negocio and telefono = tel
        and creado_at > now() - interval '1 hour' and estado in ('nuevo', 'preparando')) >= 3 then
    raise exception 'Ya tienes pedidos en proceso. Espera a que se entreguen.';
  end if;
  cod := 'AV-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 5));
  insert into pedidos (negocio_id, codigo, tipo, cliente, telefono, direccion, referencias, metodo_pago, paga_con, notas)
    values (p_negocio, cod, p_tipo, nom, tel, left(btrim(coalesce(p_direccion, '')), 200), left(p_referencias, 200),
            p_metodo, p_paga_con, left(p_notas, 300))
    returning id into pid;
  for it in select * from jsonb_array_elements(p_items) loop
    c := (it->>'cantidad')::numeric;
    if c is null or c <= 0 or c > 50 or c <> trunc(c) then raise exception 'Cantidad inválida'; end if;
    select * into p from productos where id = (it->>'producto_id')::uuid and negocio_id = p_negocio and activo and en_linea;
    if not found then raise exception 'Un producto ya no está disponible'; end if;
    insert into pedido_items (pedido_id, negocio_id, producto_id, nombre, cantidad, precio) values (pid, p_negocio, p.id, p.nombre, c, p.precio);
    sub := sub + c * p.precio;
  end loop;
  if sub < t.pedido_minimo then raise exception 'El pedido mínimo es de $%', t.pedido_minimo; end if;
  if p_tipo = 'domicilio' then
    env := case when t.envio_gratis_desde is not null and sub >= t.envio_gratis_desde then 0 else t.costo_envio end;
  end if;
  update pedidos set subtotal = sub, envio = env, total = sub + env where id = pid;
  return jsonb_build_object('codigo', cod, 'total', sub + env);
end $$;
grant execute on function crear_pedido(uuid, text, text, text, text, text, text, numeric, text, jsonb) to anon, authenticated;

create or replace function pedido_estado(p_codigo text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'codigo', p.codigo, 'estado', p.estado, 'tipo', p.tipo, 'cliente', p.cliente, 'creado_at', p.creado_at,
    'subtotal', p.subtotal, 'envio', p.envio, 'total', p.total, 'metodo_pago', p.metodo_pago,
    'items', (select coalesce(jsonb_agg(jsonb_build_object('nombre', i.nombre, 'cantidad', i.cantidad, 'precio', i.precio)), '[]'::jsonb)
              from pedido_items i where i.pedido_id = p.id))
  from pedidos p where p.codigo = upper(btrim(p_codigo))
$$;
grant execute on function pedido_estado(text) to anon, authenticated;

-- Convierte el pedido en venta (descuenta stock, entra a caja y a reportes). El envío NO cuenta como venta de producto.
create or replace function entregar_pedido(p_pedido uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare pe pedidos%rowtype; v uuid; i pedido_items%rowtype; cst numeric; tot numeric := 0; ctot numeric := 0; tid uuid;
begin
  select * into pe from pedidos where id = p_pedido for update;
  if not found or not es_miembro(pe.negocio_id) then raise exception 'Sin acceso'; end if;
  if pe.estado = 'entregado' then return pe.venta_id; end if;
  if pe.estado = 'cancelado' then raise exception 'El pedido está cancelado'; end if;
  select id into tid from caja_turnos where negocio_id = pe.negocio_id and cerrada_at is null order by abierta_at desc limit 1;
  insert into ventas (negocio_id, metodo_pago, origen, nota, cliente, turno_id)
    values (pe.negocio_id, pe.metodo_pago, 'online', 'Pedido ' || pe.codigo, pe.cliente, tid) returning id into v;
  for i in select * from pedido_items where pedido_id = pe.id loop
    select costo into cst from productos where id = i.producto_id;
    insert into venta_items (venta_id, negocio_id, producto_id, nombre, cantidad, precio, costo)
      values (v, pe.negocio_id, i.producto_id, i.nombre, i.cantidad, i.precio, coalesce(cst, 0));
    if i.producto_id is not null then
      update productos set stock = stock - i.cantidad where id = i.producto_id;
      insert into movimientos_stock (negocio_id, producto_id, delta, motivo, ref) values (pe.negocio_id, i.producto_id, -i.cantidad, 'venta', v);
    end if;
    tot := tot + i.cantidad * i.precio;
    ctot := ctot + i.cantidad * coalesce(cst, 0);
  end loop;
  update ventas set total = tot, costo_total = ctot where id = v;
  update pedidos set estado = 'entregado', venta_id = v, actualizado_at = now() where id = pe.id;
  return v;
end $$;

create or replace function cambiar_estado_pedido(p_pedido uuid, p_estado text) returns void
language plpgsql security definer set search_path = public as $$
declare pe pedidos%rowtype;
begin
  select * into pe from pedidos where id = p_pedido for update;
  if not found or not es_miembro(pe.negocio_id) then raise exception 'Sin acceso'; end if;
  if p_estado not in ('nuevo', 'preparando', 'listo', 'entregado', 'cancelado') then raise exception 'Estado inválido'; end if;
  if pe.estado in ('entregado', 'cancelado') then raise exception 'El pedido ya está cerrado'; end if;
  if p_estado = 'entregado' then perform entregar_pedido(p_pedido); return; end if;
  update pedidos set estado = p_estado, actualizado_at = now() where id = p_pedido;
end $$;

-- ---------- Caja ----------
create or replace function abrir_caja(p_negocio uuid, p_fondo numeric) returns uuid
language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  if not es_miembro(p_negocio) then raise exception 'Sin acceso'; end if;
  if exists (select 1 from caja_turnos where negocio_id = p_negocio and cerrada_at is null) then raise exception 'Ya hay una caja abierta'; end if;
  insert into caja_turnos (negocio_id, fondo) values (p_negocio, greatest(coalesce(p_fondo, 0), 0)) returning id into tid;
  return tid;
end $$;

create or replace function mov_caja(p_turno uuid, p_tipo text, p_monto numeric, p_concepto text) returns void
language plpgsql security definer set search_path = public as $$
declare tu caja_turnos%rowtype;
begin
  select * into tu from caja_turnos where id = p_turno;
  if not found or not es_miembro(tu.negocio_id) then raise exception 'Sin acceso'; end if;
  if tu.cerrada_at is not null then raise exception 'La caja ya está cerrada'; end if;
  insert into caja_movimientos (negocio_id, turno_id, tipo, monto, concepto) values (tu.negocio_id, p_turno, p_tipo, p_monto, p_concepto);
end $$;

create or replace function cerrar_caja(p_turno uuid, p_contado numeric, p_notas text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tu caja_turnos%rowtype; efe numeric; ing numeric; ret numeric; esp numeric;
begin
  select * into tu from caja_turnos where id = p_turno for update;
  if not found or not es_miembro(tu.negocio_id) then raise exception 'Sin acceso'; end if;
  if tu.cerrada_at is not null then raise exception 'La caja ya está cerrada'; end if;
  select coalesce(sum(total), 0) into efe from ventas where turno_id = p_turno and estado = 'activa' and metodo_pago = 'efectivo';
  select coalesce(sum(monto) filter (where tipo = 'ingreso'), 0), coalesce(sum(monto) filter (where tipo = 'retiro'), 0)
    into ing, ret from caja_movimientos where turno_id = p_turno;
  esp := tu.fondo + efe + ing - ret;
  update caja_turnos set cerrada_at = now(), esperado = esp, contado = p_contado, diferencia = p_contado - esp, notas = p_notas where id = p_turno;
  return jsonb_build_object('esperado', esp, 'contado', p_contado, 'diferencia', p_contado - esp);
end $$;

-- ---------- Tiempo real (aviso de pedidos nuevos) ----------
do $$ begin alter publication supabase_realtime add table pedidos; exception when others then null; end $$;

-- ---------- Datos iniciales de la tienda ----------
insert into tienda (negocio_id) values ('00000000-0000-0000-0000-0000000000a1') on conflict do nothing;

notify pgrst, 'reload schema';

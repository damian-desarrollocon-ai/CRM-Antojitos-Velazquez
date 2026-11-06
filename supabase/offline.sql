-- =====================================================================
-- Modo sin internet: ventas con folio propio y hora original
-- Correr UNA vez en Supabase → SQL Editor (antes de subir el código nuevo).
-- =====================================================================
-- Cada venta hecha sin internet trae su propio folio (p_id) y su hora (p_ts).
-- Si la misma venta llega dos veces, NO se duplica: el servidor reconoce el folio.
-- Las ventas guardadas offline conservan el precio y costo con que se vendieron.
drop function if exists registrar_venta(uuid, jsonb, text, numeric, numeric, text);
create or replace function registrar_venta(
  p_negocio uuid, p_items jsonb, p_metodo text default 'efectivo', p_descuento numeric default 0,
  p_pago_con numeric default null, p_nota text default null, p_id uuid default null, p_ts timestamptz default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; it jsonb; p productos%rowtype; c numeric; pr numeric; co numeric;
        tot numeric := 0; ctot numeric := 0; tid uuid; neto numeric; ts timestamptz;
begin
  if not es_miembro(p_negocio) then raise exception 'Sin acceso a este negocio'; end if;
  if p_metodo not in ('efectivo', 'transferencia', 'tarjeta') then raise exception 'Método de pago inválido'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'La venta está vacía'; end if;

  -- Si este folio ya existe, la venta ya se guardó: regresamos el mismo folio (no se duplica).
  if p_id is not null and exists (select 1 from ventas where id = p_id) then
    if exists (select 1 from ventas where id = p_id and negocio_id = p_negocio) then return p_id; end if;
    raise exception 'Folio inválido';
  end if;

  ts := case when p_ts is null or p_ts > now() + interval '5 minutes' then now() else p_ts end;
  select id into tid from caja_turnos where negocio_id = p_negocio and cerrada_at is null order by abierta_at desc limit 1;
  insert into ventas (id, negocio_id, metodo_pago, nota, turno_id, creada_at, fecha)
    values (coalesce(p_id, gen_random_uuid()), p_negocio, p_metodo, p_nota, tid, ts, (ts at time zone 'America/Mexico_City')::date)
    returning id into v;

  for it in select * from jsonb_array_elements(p_items) loop
    c := (it->>'cantidad')::numeric;
    if c is null or c <= 0 then raise exception 'Cantidad inválida'; end if;
    select * into p from productos where id = (it->>'producto_id')::uuid and negocio_id = p_negocio for update;
    if not found then raise exception 'Producto inválido'; end if;
    pr := coalesce((it->>'precio')::numeric, p.precio);
    co := coalesce((it->>'costo')::numeric, p.costo);
    if pr < 0 or co < 0 then raise exception 'Precio inválido'; end if;
    insert into venta_items (venta_id, negocio_id, producto_id, nombre, cantidad, precio, costo)
      values (v, p_negocio, p.id, p.nombre, c, pr, co);
    update productos set stock = stock - c where id = p.id;
    insert into movimientos_stock (negocio_id, producto_id, delta, motivo, ref) values (p_negocio, p.id, -c, 'venta', v);
    tot := tot + c * pr;
    ctot := ctot + c * co;
  end loop;

  if coalesce(p_descuento, 0) < 0 or coalesce(p_descuento, 0) > tot then raise exception 'Descuento inválido'; end if;
  neto := tot - coalesce(p_descuento, 0);
  update ventas set total = neto, costo_total = ctot, descuento = coalesce(p_descuento, 0), pago_con = p_pago_con,
    cambio = case when p_metodo = 'efectivo' and p_pago_con is not null then greatest(p_pago_con - neto, 0) end
  where id = v;
  return v;
end $$;

notify pgrst, 'reload schema';

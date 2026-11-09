-- =====================================================================
-- Origen de los pedidos (QR, Facebook, WhatsApp…)
-- Correr UNA vez en Supabase → SQL Editor, antes de subir el código nuevo.
-- =====================================================================
alter table pedidos add column if not exists origen text;

drop function if exists crear_pedido(uuid, text, text, text, text, text, text, numeric, text, jsonb);
create or replace function crear_pedido(
  p_negocio uuid, p_cliente text, p_telefono text, p_tipo text, p_direccion text, p_referencias text,
  p_metodo text, p_paga_con numeric, p_notas text, p_items jsonb, p_origen text default null
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
  insert into pedidos (negocio_id, codigo, tipo, cliente, telefono, direccion, referencias, metodo_pago, paga_con, notas, origen)
    values (p_negocio, cod, p_tipo, nom, tel, left(btrim(coalesce(p_direccion, '')), 200), left(p_referencias, 200),
            p_metodo, p_paga_con, left(p_notas, 300),
            nullif(left(regexp_replace(lower(coalesce(p_origen, '')), '[^a-z0-9_-]', '', 'g'), 20), ''))
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
grant execute on function crear_pedido(uuid, text, text, text, text, text, text, numeric, text, jsonb, text) to anon, authenticated;

notify pgrst, 'reload schema';

-- =====================================================================
-- Aviso de pedidos nuevos a Telegram (llega al celular aunque el POS esté cerrado)
-- =====================================================================
-- ANTES de correr este archivo:
--  1) En Telegram busca @BotFather → /newbot → ponle nombre → te da un TOKEN (guárdalo, es secreto).
--  2) Crea un grupo "Pedidos Antojitos", agrega a tus socios y agrega a tu bot al grupo.
--  3) Escribe cualquier mensaje en el grupo y abre en el navegador:
--       https://api.telegram.org/bot<TU_TOKEN>/getUpdates
--     Busca "chat":{"id":-123456789 ...} → ese número (con el signo -) es el CHAT_ID del grupo.
--     (Para recibirlo solo tú: escríbele "hola" al bot y usa tu id numérico.)
--  4) Corre este archivo, y luego los dos INSERT de abajo con tus datos reales (ejecútalos aparte).
-- =====================================================================
create extension if not exists pg_net with schema extensions;

-- Tabla privada: con RLS y SIN políticas, desde la app nadie puede leerla.
create table if not exists secretos (clave text primary key, valor text not null);
alter table secretos enable row level security;

create or replace function notificar_pedido_telegram() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare tok text; chats text; cid text; txt text; items text;
begin
  select valor into tok from secretos where clave = 'telegram_token';
  select valor into chats from secretos where clave = 'telegram_chat_id';
  if tok is null or chats is null then return new; end if;

  select string_agg(cantidad::int || ' × ' || nombre, E'\n' order by nombre) into items from pedido_items where pedido_id = new.id;

  txt := '🛵 NUEVO PEDIDO ' || new.codigo || E'\n'
      || '👤 ' || new.cliente || ' · ' || new.telefono || E'\n'
      || case when new.tipo = 'domicilio'
              then '📍 ' || coalesce(new.direccion, '') || coalesce(' (' || nullif(new.referencias, '') || ')', '')
              else '🏪 Recoge en tienda' end || E'\n\n'
      || coalesce(items, '') || E'\n\n'
      || '💵 Total $' || trim(to_char(new.total, 'FM999,990.00')) || ' · ' || new.metodo_pago
      || case when new.paga_con is not null then E'\nPaga con $' || trim(to_char(new.paga_con, 'FM999990.##')) else '' end
      || case when new.notas is not null then E'\n📝 ' || new.notas else '' end
      || case when new.origen is not null then E'\nOrigen: ' || new.origen else '' end;

  foreach cid in array string_to_array(replace(chats, ' ', ''), ',') loop
    perform net.http_post(
      url := 'https://api.telegram.org/bot' || tok || '/sendMessage',
      body := jsonb_build_object('chat_id', cid, 'text', txt),
      headers := '{"Content-Type": "application/json"}'::jsonb);
  end loop;
  return new;
exception when others then
  return new;   -- un fallo del aviso nunca debe bloquear un pedido
end $$;

-- Se dispara una sola vez por pedido: cuando ya tiene sus productos y su total.
drop trigger if exists pedido_nuevo_telegram on pedidos;
create trigger pedido_nuevo_telegram after update of total on pedidos
  for each row when (old.total = 0 and new.total > 0)
  execute function notificar_pedido_telegram();

-- ---------------------------------------------------------------------
-- EJECUTA APARTE, con tus datos reales (no los subas a GitHub):
--   insert into secretos (clave, valor) values ('telegram_token', '123456:ABC-TU-TOKEN')
--     on conflict (clave) do update set valor = excluded.valor;
--   insert into secretos (clave, valor) values ('telegram_chat_id', '-123456789')
--     on conflict (clave) do update set valor = excluded.valor;
-- Para varios destinos separa los id con coma: '-123456789,987654321'
-- ---------------------------------------------------------------------

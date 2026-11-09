-- =====================================================================
-- Fotos de productos (desde galería o cámara) + datos de transferencia
-- Correr UNA vez en Supabase → SQL Editor, antes de subir el código nuevo.
-- =====================================================================

-- ---------- Fotos: bucket público (todos ven las fotos, solo admin/socio las sube) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('productos', 'productos', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- La primera carpeta de cada archivo es el id del negocio: solo su admin/socio puede subir, cambiar o borrar.
drop policy if exists fotos_productos_select on storage.objects;
create policy fotos_productos_select on storage.objects for select to authenticated
  using (bucket_id = 'productos' and es_admin(((storage.foldername(name))[1])::uuid));
drop policy if exists fotos_productos_insert on storage.objects;
create policy fotos_productos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'productos' and es_admin(((storage.foldername(name))[1])::uuid));
drop policy if exists fotos_productos_update on storage.objects;
create policy fotos_productos_update on storage.objects for update to authenticated
  using (bucket_id = 'productos' and es_admin(((storage.foldername(name))[1])::uuid));
drop policy if exists fotos_productos_delete on storage.objects;
create policy fotos_productos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'productos' and es_admin(((storage.foldername(name))[1])::uuid));

-- ---------- Datos de transferencia ----------
alter table tienda
  add column if not exists transf_banco text,
  add column if not exists transf_titular text,
  add column if not exists transf_clabe text,
  add column if not exists transf_nota text;

-- Los datos NO se publican en la tienda: solo los recibe el cliente que eligió transferencia,
-- junto con su código de pedido (después de confirmar).
create or replace function pedido_estado(p_codigo text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'codigo', p.codigo, 'estado', p.estado, 'tipo', p.tipo, 'cliente', p.cliente, 'creado_at', p.creado_at,
    'subtotal', p.subtotal, 'envio', p.envio, 'total', p.total, 'metodo_pago', p.metodo_pago,
    'items', (select coalesce(jsonb_agg(jsonb_build_object('nombre', i.nombre, 'cantidad', i.cantidad, 'precio', i.precio)), '[]'::jsonb)
              from pedido_items i where i.pedido_id = p.id),
    'transferencia', case when p.metodo_pago = 'transferencia' then
        (select jsonb_build_object('banco', t.transf_banco, 'titular', t.transf_titular, 'clabe', t.transf_clabe, 'nota', t.transf_nota)
         from tienda t where t.negocio_id = p.negocio_id) end)
  from pedidos p where p.codigo = upper(btrim(p_codigo))
$$;
grant execute on function pedido_estado(text) to anon, authenticated;

notify pgrst, 'reload schema';

-- ELIO · Versión 24 (27-nov-2026): aprender y mejorar con datos ANÓNIMOS y AGREGADOS (pedido del usuario).
--  - Contadores por día, plan y motor: temas (por CATEGORÍA, nunca el texto), errores, topes y frenos.
--  - Sin identificador de persona en estos contadores, sin terceros y sin perfilar a nadie.
--  - Embudo (quién se registra y llega a usar Elio, chats de un solo mensaje) se calcula al vuelo, solo en totales.
-- Se ejecuta en el SQL Editor del proyecto «elio». Se puede repetir sin daño.

create table if not exists public.metricas_uso (
  dia date not null default (now() at time zone 'America/Lima')::date,
  plan text not null,          -- invitado | libre | impulso | ultra
  motor text not null default '-',
  tipo text not null check (tipo in ('tema','error','tope')),
  clave text not null check (length(clave) <= 40),   -- p. ej. «estudio», «proveedor», «invitado_4»
  n int not null default 0,
  primary key (dia, plan, motor, tipo, clave)
);
alter table public.metricas_uso enable row level security;   -- sin políticas: solo el servidor y el resumen del admin

create or replace function public.elio_metrica(p_plan text, p_motor text, p_tipo text, p_clave text) returns void
language sql security definer set search_path = public as $$
  insert into public.metricas_uso (plan, motor, tipo, clave, n) values (p_plan, coalesce(p_motor, '-'), p_tipo, left(p_clave, 40), 1)
  on conflict (dia, plan, motor, tipo, clave) do update set n = metricas_uso.n + 1
$$;
revoke all on function public.elio_metrica(text, text, text, text) from public, anon, authenticated;

-- Resumen de 7 días para el dueño (2FA). Solo totales.
create or replace function public.elio_admin_aprendizaje() returns json
language plpgsql stable security definer set search_path = public as $$
declare desde date := ((now() at time zone 'America/Lima')::date - 6);
begin
  if not public.elio_es_admin() then raise exception 'Solo administradores'; end if;
  return json_build_object(
    'temas', coalesce((select json_agg(x) from (select clave, sum(n)::int n from public.metricas_uso where tipo = 'tema' and dia >= desde group by clave order by sum(n) desc) x), '[]'::json),
    'por_motor', coalesce((select json_agg(x) from (select motor, plan, sum(n)::int n from public.metricas_uso where tipo = 'tema' and dia >= desde group by motor, plan order by sum(n) desc) x), '[]'::json),
    'errores', coalesce((select json_agg(x) from (select clave, sum(n)::int n from public.metricas_uso where tipo = 'error' and dia >= desde group by clave order by sum(n) desc) x), '[]'::json),
    'topes', coalesce((select json_agg(x) from (select clave, plan, sum(n)::int n from public.metricas_uso where tipo = 'tope' and dia >= desde group by clave, plan order by sum(n) desc) x), '[]'::json),
    'embudo', json_build_object(
      'registros', (select count(*) from public.perfiles where creado >= desde),
      'registros_que_chatearon', (select count(*) from public.perfiles p where p.creado >= desde and exists (select 1 from public.mensajes m where m.usuario = p.id)),
      'chats', (select count(*) from public.conversaciones where creado >= desde),
      'chats_de_un_mensaje', (select count(*) from public.conversaciones c where c.creado >= desde and (select count(*) from public.mensajes m where m.conversacion = c.id and m.rol = 'user') <= 1)
    )
  );
end $$;
revoke all on function public.elio_admin_aprendizaje() from public, anon;
grant execute on function public.elio_admin_aprendizaje() to authenticated;

-- Retención: 24 meses de contadores (son totales anónimos)
create or replace function public.elio_limpiar_metricas() returns void
language sql security definer set search_path = public as $$
  delete from public.metricas_uso where dia < (now() at time zone 'America/Lima')::date - 730
$$;
revoke all on function public.elio_limpiar_metricas() from public, anon, authenticated;

-- Comprobación: 3 filas en «true»
select 'metricas_rls' as que, (select rowsecurity from pg_tables where schemaname='public' and tablename='metricas_uso') as ok
union all select 'metrica_cerrada', not has_function_privilege('authenticated', 'public.elio_metrica(text, text, text, text)', 'execute')
union all select 'resumen_2fa', pg_get_functiondef('public.elio_admin_aprendizaje()'::regprocedure) like '%elio_es_admin%';

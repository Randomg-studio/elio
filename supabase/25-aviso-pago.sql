-- ELIO · Versión 25 (27-nov-2026): aviso de pago por vencer, vencido y pausado (decisión del usuario).
--  Hoy Elio cobra por Yape/Plin y el plan dura 30 días (no hay tarjeta guardada ni cobro automático). Por eso:
--   1) Por vencer: 3 días antes de la fecha.
--   2) Vencido: desde la fecha, con 3 días de GRACIA en los que el plan sigue activo (solo planes pagados, no la prueba gratis).
--   3) Pausado: pasada la gracia, la cuenta vuelve a Libre; sus conversaciones siguen guardadas.
--  Correo automático en cada momento (Brevo, una sola vez por momento y fecha) y lista «Por cobrar» en el panel.
-- Se ejecuta en el SQL Editor del proyecto «elio». Se puede repetir sin daño.

-- ¿La persona pagó alguna vez? (la prueba gratis de Impulso no cuenta)
create or replace function public.elio_es_pagado(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.pagos where usuario = u and estado = 'aprobado')
$$;
revoke all on function public.elio_es_pagado(uuid) from public, anon, authenticated;

-- Plan propio con 3 días de gracia para planes pagados
create or replace function public.elio_plan_propio(u uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p.plan = 'libre' then 'libre'
    when p.plan_vence is null then 'libre'
    when p.plan_vence >= public.elio_hoy() then p.plan
    when public.elio_es_pagado(u) and p.plan_vence + 3 >= public.elio_hoy() then p.plan   -- gracia
    else 'libre' end
  from public.perfiles p where p.id = u
$$;
revoke all on function public.elio_plan_propio(uuid) from public, anon, authenticated;

-- Estado de pago de una persona: al_dia | por_vencer | vencido (en gracia) | pausado | sin_plan
create or replace function public.elio_estado_pago(u uuid) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'plan', p.plan, 'vence', p.plan_vence, 'monto', public.elio_precio(p.plan),
    'gracia_hasta', case when p.plan_vence is not null then p.plan_vence + 3 end,
    'estado', case
      when p.plan = 'libre' or p.plan_vence is null or not public.elio_es_pagado(u) then 'sin_plan'
      when p.plan_vence - public.elio_hoy() between 0 and 3 then 'por_vencer'
      when p.plan_vence >= public.elio_hoy() then 'al_dia'
      when p.plan_vence + 3 >= public.elio_hoy() then 'vencido'
      when p.plan_vence + 30 >= public.elio_hoy() then 'pausado'
      else 'sin_plan' end,
    'pago_pendiente', exists (select 1 from public.pagos g where g.usuario = u and g.estado = 'pendiente'))
  from public.perfiles p where p.id = u
$$;
revoke all on function public.elio_estado_pago(uuid) from public, anon, authenticated;

create or replace function public.elio_mi_pago() returns json
language sql stable security definer set search_path = public as $$ select public.elio_estado_pago(auth.uid()) $$;
revoke all on function public.elio_mi_pago() from public, anon;
grant execute on function public.elio_mi_pago() to authenticated;

-- Correos enviados (uno por momento y fecha de vencimiento)
create table if not exists public.avisos_pago (
  usuario uuid not null references auth.users on delete cascade,
  momento text not null check (momento in ('por_vencer','vencido','pausado')),
  vence date not null,
  enviado timestamptz not null default now(),
  primary key (usuario, momento, vence)
);
alter table public.avisos_pago enable row level security;   -- sin políticas: solo el servidor

-- Revisión diaria: envía el correo de cada momento una sola vez
create or replace function public.elio_avisos_pago_diario() returns int
language plpgsql security definer set search_path = public as $$
declare r record; e json; est text; asunto text; cuerpo text; n int := 0; plan_n text; url text := 'https://elio.flexgogroup.com/?pagar';
begin
  for r in select p.id, p.nombre, p.plan, p.plan_vence, u.email from public.perfiles p join auth.users u on u.id = p.id
           where p.plan <> 'libre' and p.plan_vence is not null and p.plan_vence between public.elio_hoy() - 30 and public.elio_hoy() + 3 loop
    e := public.elio_estado_pago(r.id); est := e->>'estado';
    if est not in ('por_vencer','vencido','pausado') or (e->>'pago_pendiente')::boolean then continue; end if;
    if exists (select 1 from public.avisos_pago where usuario = r.id and momento = est and vence = r.plan_vence) then continue; end if;
    plan_n := initcap(r.plan);
    asunto := case est when 'por_vencer' then 'Tu plan ' || plan_n || ' de Elio vence pronto'
                       when 'vencido' then 'Tu plan ' || plan_n || ' de Elio venció: tienes 3 días para renovarlo'
                       else 'Tu plan ' || plan_n || ' de Elio está en pausa' end;
    cuerpo := 'Hola ' || coalesce(split_part(r.nombre, ' ', 1), '') || '. ' || case est
      when 'por_vencer' then 'Tu plan ' || plan_n || ' vence el ' || to_char(r.plan_vence, 'DD/MM/YYYY') || '. Para no perder tus créditos, renuévalo por S/ ' || to_char(public.elio_precio(r.plan), 'FM990.00') || ' (IGV incluido) con Yape o Plin.'
      when 'vencido' then 'Tu plan ' || plan_n || ' venció el ' || to_char(r.plan_vence, 'DD/MM/YYYY') || ' y todavía no registramos tu pago. Lo mantenemos activo 3 días más, hasta el ' || to_char(r.plan_vence + 3, 'DD/MM/YYYY') || '. Renuévalo por S/ ' || to_char(public.elio_precio(r.plan), 'FM990.00') || ' (IGV incluido) con Yape o Plin.'
      else 'Tu plan ' || plan_n || ' pasó a Libre porque no registramos tu pago. Tus conversaciones siguen guardadas. Reactívalo cuando quieras por S/ ' || to_char(public.elio_precio(r.plan), 'FM990.00') || ' (IGV incluido).' end;
    perform public.elio_correo(r.email, asunto,
      '<p>' || public.elio_html(cuerpo) || '</p><p><a href="' || url || '">Renovar en Elio</a></p><p>¿Dudas? Escríbele a Kivo por WhatsApp: +51 917 952 528.</p><p style="color:#888">Elio by FlexGo Group</p>',
      cuerpo || ' Renovar: ' || url, 'elio-aviso-pago');
    insert into public.avisos_pago (usuario, momento, vence) values (r.id, est, r.plan_vence) on conflict do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.elio_avisos_pago_diario() from public, anon, authenticated;

-- Todos los días a las 9:10 a. m. de Lima (14:10 UTC)
select cron.unschedule('elio-avisos-pago') where exists (select 1 from cron.job where jobname = 'elio-avisos-pago');
select cron.schedule('elio-avisos-pago', '10 14 * * *', 'select public.elio_avisos_pago_diario()');

-- Lista «Por cobrar» para el panel del dueño (2FA)
create or replace function public.elio_admin_por_cobrar() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.elio_es_admin() then raise exception 'Solo administradores'; end if;
  return coalesce((select json_agg(x order by x.vence) from (
    select p.id, p.nombre, u.email, p.plan, p.plan_vence as vence, public.elio_precio(p.plan) as monto,
           public.elio_estado_pago(p.id)->>'estado' as estado, (public.elio_estado_pago(p.id)->>'pago_pendiente')::boolean as pago_pendiente
    from public.perfiles p join auth.users u on u.id = p.id
    where p.plan <> 'libre' and p.plan_vence is not null and p.plan_vence between public.elio_hoy() - 30 and public.elio_hoy() + 3
      and public.elio_es_pagado(p.id)) x), '[]'::json);
end $$;
revoke all on function public.elio_admin_por_cobrar() from public, anon;
grant execute on function public.elio_admin_por_cobrar() to authenticated;

-- Comprobación: 4 filas en «true»
select 'avisos_rls' as que, (select rowsecurity from pg_tables where schemaname='public' and tablename='avisos_pago') as ok
union all select 'cron', exists (select 1 from cron.job where jobname = 'elio-avisos-pago')
union all select 'mi_pago_no_anon', not has_function_privilege('anon', 'public.elio_mi_pago()', 'execute')
union all select 'por_cobrar_2fa', pg_get_functiondef('public.elio_admin_por_cobrar()'::regprocedure) like '%elio_es_admin%';

-- ELIO · Versión 4 (25-nov-2026): intereses con permiso (Ley 29733) y recomendaciones de FlexGo.
--  - Dos permisos separados y desmarcados: «aprender mis intereses» y «recibir ofertas». Sin permiso no se guarda nada.
--  - Se guardan etiquetas cortas (rubro, tema, necesidad, servicio), nunca el chat completo ni datos sensibles.
--  - Cada persona puede ver, descargar y borrar lo que Elio sabe, y apagar el aprendizaje cuando quiera (ARCO).
--  - Las etiquetas se borran solas a los 12 meses.
--  - El administrador ve estadísticas y solo ve nombres de quienes aceptaron recibir ofertas.
-- Se ejecuta en el SQL Editor del proyecto «elio». Se puede repetir sin daño.

alter table public.perfiles add column if not exists aprende boolean not null default false;
alter table public.perfiles add column if not exists acepta_ofertas boolean not null default false;
alter table public.perfiles add column if not exists permiso_fecha timestamptz;

create table if not exists public.intereses (
  id bigserial primary key,
  usuario uuid not null references auth.users on delete cascade,
  creado timestamptz not null default now(),
  rubro text check (length(rubro) <= 40),
  tema text check (length(tema) <= 40),
  necesidad text check (length(necesidad) <= 80),
  quiere_comprar boolean not null default false,
  servicio text check (servicio in ('logrin','creago','kivo','paginas_web','eleva'))
);
create index if not exists intereses_usuario on public.intereses (usuario, creado desc);

create table if not exists public.recomendaciones (
  id bigserial primary key,
  usuario uuid not null references auth.users on delete cascade,
  servicio text not null check (servicio in ('logrin','creago','kivo','paginas_web','eleva')),
  conversacion uuid,
  clic boolean not null default false,
  creado timestamptz not null default now()
);
create index if not exists recomendaciones_usuario on public.recomendaciones (usuario, creado desc);

alter table public.intereses enable row level security;
alter table public.recomendaciones enable row level security;
drop policy if exists "intereses propios ver" on public.intereses;
create policy "intereses propios ver" on public.intereses for select using (usuario = auth.uid());
drop policy if exists "recomendaciones propias ver" on public.recomendaciones;
create policy "recomendaciones propias ver" on public.recomendaciones for select using (usuario = auth.uid());
-- Sin políticas de escritura: solo escriben la función del servidor y las funciones de abajo.

-- ---------- Permiso al registrarse (casilla opcional) ----------
create or replace function public.elio_nuevo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
declare a boolean := coalesce((new.raw_user_meta_data->>'aprende')::boolean, false);
        o boolean := coalesce((new.raw_user_meta_data->>'ofertas')::boolean, false);
begin
  insert into public.perfiles (id, nombre, aprende, acepta_ofertas, permiso_fecha)
  values (new.id, left(coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)), 40), a, o, case when a or o then now() end)
  on conflict (id) do nothing;
  return new;
end $$;

-- ---------- Lo que ve y controla cada persona (Ajustes › Privacidad) ----------
create or replace function public.elio_mi_privacidad() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'aprende', p.aprende, 'acepta_ofertas', p.acepta_ofertas, 'permiso_fecha', p.permiso_fecha,
    'intereses', coalesce((select json_agg(json_build_object('fecha', i.creado, 'rubro', i.rubro, 'tema', i.tema, 'necesidad', i.necesidad,
                   'quiere_comprar', i.quiere_comprar, 'servicio', i.servicio) order by i.creado desc)
                 from (select * from public.intereses where usuario = p.id order by creado desc limit 200) i), '[]'::json),
    'recomendaciones', coalesce((select json_agg(json_build_object('fecha', r.creado, 'servicio', r.servicio, 'clic', r.clic) order by r.creado desc)
                 from (select * from public.recomendaciones where usuario = p.id order by creado desc limit 200) r), '[]'::json))
  from public.perfiles p where p.id = auth.uid()
$$;

create or replace function public.elio_privacidad_ajustar(aprender boolean, ofertas boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.perfiles set
    aprende = aprender,
    acepta_ofertas = ofertas,
    permiso_fecha = case when aprender or ofertas then now() else permiso_fecha end
  where id = auth.uid();
  -- Si apaga el aprendizaje, lo aprendido se borra en el acto.
  if not aprender then
    delete from public.intereses where usuario = auth.uid();
    delete from public.recomendaciones where usuario = auth.uid();
  end if;
end $$;

create or replace function public.elio_borrar_mis_intereses() returns void
language sql security definer set search_path = public as $$
  delete from public.intereses where usuario = auth.uid();
  delete from public.recomendaciones where usuario = auth.uid();
$$;

-- Clic en un enlace recomendado (solo se anota si la persona dio permiso)
create or replace function public.elio_clic_recomendacion(serv text, conv uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not coalesce((select aprende from public.perfiles where id = auth.uid()), false) then return; end if;
  if serv not in ('logrin','creago','kivo','paginas_web','eleva') then return; end if;
  update public.recomendaciones set clic = true
   where id = (select id from public.recomendaciones where usuario = auth.uid() and servicio = serv
                and (conv is null or conversacion = conv) order by creado desc limit 1);
  if not found then
    insert into public.recomendaciones (usuario, servicio, conversacion, clic) values (auth.uid(), serv, conv, true);
  end if;
end $$;

revoke all on function public.elio_mi_privacidad() from public, anon;
revoke all on function public.elio_privacidad_ajustar(boolean, boolean) from public, anon;
revoke all on function public.elio_borrar_mis_intereses() from public, anon;
revoke all on function public.elio_clic_recomendacion(text, uuid) from public, anon;
grant execute on function public.elio_mi_privacidad() to authenticated;
grant execute on function public.elio_privacidad_ajustar(boolean, boolean) to authenticated;
grant execute on function public.elio_borrar_mis_intereses() to authenticated;
grant execute on function public.elio_clic_recomendacion(text, uuid) to authenticated;

-- ---------- Estadísticas para el administrador (con 2FA) ----------
create or replace function public.elio_admin_intereses() returns json
language plpgsql stable security definer set search_path = public as $$
declare desde timestamptz := now() - interval '30 days';
begin
  if not public.elio_es_admin() then raise exception 'Solo administradores'; end if;
  return json_build_object(
    'con_permiso', (select count(*) from public.perfiles where aprende),
    'temas', (select coalesce(json_agg(x), '[]'::json) from (select tema as nombre, count(*) n from public.intereses
               where creado > desde and tema is not null group by 1 order by 2 desc limit 10) x),
    'rubros', (select coalesce(json_agg(x), '[]'::json) from (select rubro as nombre, count(*) n from public.intereses
               where creado > desde and rubro is not null group by 1 order by 2 desc limit 10) x),
    'servicios', (select coalesce(json_agg(x), '[]'::json) from (
               select s.servicio,
                 (select count(distinct usuario) from public.intereses i where i.servicio = s.servicio and i.creado > desde) as interesados,
                 (select count(*) from public.recomendaciones r where r.servicio = s.servicio and r.creado > desde) as mostradas,
                 (select count(*) from public.recomendaciones r where r.servicio = s.servicio and r.clic and r.creado > desde) as clics
               from (values ('logrin'),('creago'),('kivo'),('paginas_web'),('eleva')) s(servicio)) x),
    -- Nombres y correos SOLO de quienes aceptaron recibir ofertas y mostraron intención de compra
    'contactables', (select coalesce(json_agg(x), '[]'::json) from (
               select p.nombre, au.email, string_agg(distinct i.servicio, ', ') as servicios, max(i.creado) as ultimo
               from public.intereses i join public.perfiles p on p.id = i.usuario join auth.users au on au.id = i.usuario
               where p.acepta_ofertas and i.quiere_comprar and i.servicio is not null and i.creado > desde
               group by p.nombre, au.email order by max(i.creado) desc limit 50) x)
  );
end $$;
revoke all on function public.elio_admin_intereses() from public, anon;
grant execute on function public.elio_admin_intereses() to authenticated;

-- ---------- Las etiquetas se borran solas a los 12 meses (día 2 de cada mes) ----------
select cron.unschedule(jobid) from cron.job where jobname = 'elio-borrar-intereses-viejos';
select cron.schedule('elio-borrar-intereses-viejos', '0 15 2 * *',
  $$delete from public.intereses where creado < now() - interval '12 months'; delete from public.recomendaciones where creado < now() - interval '12 months'$$);

-- Comprobación: 5 filas en «true»
select 'columnas' as que, exists(select 1 from information_schema.columns where table_schema='public' and table_name='perfiles' and column_name='aprende') as ok
union all select 'tablas_rls', (select bool_and(rowsecurity) from pg_tables where schemaname='public' and tablename in ('intereses','recomendaciones'))
union all select 'cerrado_web', not has_function_privilege('anon', 'public.elio_mi_privacidad()', 'execute')
union all select 'admin_2fa', exists(select 1 from pg_proc where proname = 'elio_admin_intereses')
union all select 'borrado_12_meses', exists(select 1 from cron.job where jobname = 'elio-borrar-intereses-viejos');

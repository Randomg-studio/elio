-- ELIO · Versión 16 (26-nov-2026): reseñas reales.
--  - Una reseña por persona con sesión iniciada, y solo si ya usó Elio (3 mensajes o más).
--  - Se publica solo si la persona marca «permitir mostrarla» y el administrador la aprueba (con 2FA).
--  - Endpoint público de solo lectura: POST /rest/v1/rpc/elio_resenas_publicas (con la clave pública)
--    → aprobadas (nombre corto, estrellas, texto, plan, fecha), promedio y total. Nunca muestra correos ni ids.
-- Se ejecuta en el SQL Editor del proyecto «elio». Se puede repetir sin daño.

create table if not exists public.resenas (
  usuario uuid primary key references auth.users on delete cascade,
  estrellas int not null check (estrellas between 1 and 5),
  texto text not null check (length(texto) between 10 and 500),
  nombre_publico text not null check (length(nombre_publico) between 2 and 40),
  plan text not null default 'libre',
  estado text not null default 'pendiente' check (estado in ('pendiente','aprobada','rechazada')),
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  moderado timestamptz
);
alter table public.resenas enable row level security;
drop policy if exists "resena propia" on public.resenas;
create policy "resena propia" on public.resenas for select using (usuario = auth.uid());
-- Sin políticas de escritura: solo se escribe con las funciones de abajo.

-- Guardar o cambiar mi reseña (vuelve a «pendiente» para revisarla otra vez)
create or replace function public.elio_guardar_resena(estrellas int, texto text, publicar boolean) returns json
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); n text; t text := btrim(regexp_replace(coalesce(texto, ''), '\s+', ' ', 'g')); ult timestamptz;
begin
  if u is null then raise exception 'Inicia sesión para dejar tu reseña.'; end if;
  if not coalesce(publicar, false) then raise exception 'Marca la casilla para permitir que mostremos tu reseña.'; end if;
  if estrellas is null or estrellas not between 1 and 5 then raise exception 'Elige de 1 a 5 estrellas.'; end if;
  if length(t) < 10 then raise exception 'Escribe al menos 10 letras.'; end if;
  if length(t) > 500 then raise exception 'Máximo 500 letras.'; end if;
  if t ~* '(https?://|www\.)' then raise exception 'La reseña no puede llevar enlaces.'; end if;
  if (select count(*) from public.consumo where usuario = u and funcion in ('chat','probadita')) < 3 then
    raise exception 'Usa Elio un poco más (al menos 3 mensajes) antes de dejar tu reseña.';
  end if;
  select actualizado into ult from public.resenas where usuario = u;
  if ult is not null and ult > now() - interval '10 minutes' then raise exception 'Espera unos minutos para volver a cambiar tu reseña.'; end if;
  -- Nombre corto: primer nombre + inicial del apellido (nunca el correo)
  select coalesce(nullif(split_part(btrim(nombre), ' ', 1), ''), 'Usuario') ||
         coalesce(' ' || nullif(left(split_part(btrim(nombre), ' ', 2), 1), '') || '.', '')
    into n from public.perfiles where id = u;
  insert into public.resenas (usuario, estrellas, texto, nombre_publico, plan)
    values (u, estrellas, t, left(coalesce(n, 'Usuario'), 40), public.elio_plan(u))
  on conflict (usuario) do update set estrellas = excluded.estrellas, texto = excluded.texto,
    nombre_publico = excluded.nombre_publico, plan = excluded.plan, estado = 'pendiente', actualizado = now(), moderado = null;
  return json_build_object('ok', true, 'estado', 'pendiente');
end $$;
revoke all on function public.elio_guardar_resena(int, text, boolean) from public, anon;
grant execute on function public.elio_guardar_resena(int, text, boolean) to authenticated;

create or replace function public.elio_borrar_resena() returns void
language sql security definer set search_path = public as $$
  delete from public.resenas where usuario = auth.uid()
$$;
revoke all on function public.elio_borrar_resena() from public, anon;
grant execute on function public.elio_borrar_resena() to authenticated;

-- Endpoint público de solo lectura (web flexgogroup.com y la app)
create or replace function public.elio_resenas_publicas() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'total', count(*),
    'promedio', round(avg(estrellas)::numeric, 1),
    'resenas', coalesce((select json_agg(x) from (
        select nombre_publico as nombre, estrellas, texto, plan, to_char(moderado at time zone 'America/Lima', 'YYYY-MM-DD') as fecha
        from public.resenas where estado = 'aprobada' order by moderado desc limit 30) x), '[]'::json),
    'actualizado', to_char(now() at time zone 'America/Lima', 'YYYY-MM-DD HH24:MI'))
  from public.resenas where estado = 'aprobada'
$$;
revoke all on function public.elio_resenas_publicas() from public;
grant execute on function public.elio_resenas_publicas() to anon, authenticated;

-- Moderación (solo administrador con 2FA)
create or replace function public.elio_admin_resenas() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.elio_es_admin() then raise exception 'Solo administradores'; end if;
  return coalesce((select json_agg(x) from (
    select usuario as id, nombre_publico as nombre, estrellas, texto, plan, estado, actualizado
    from public.resenas order by (estado = 'pendiente') desc, actualizado desc limit 100) x), '[]'::json);
end $$;
revoke all on function public.elio_admin_resenas() from public, anon;
grant execute on function public.elio_admin_resenas() to authenticated;

create or replace function public.elio_moderar_resena(id uuid, aprobar boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.elio_es_admin() then raise exception 'Solo administradores'; end if;
  update public.resenas set estado = case when aprobar then 'aprobada' else 'rechazada' end, moderado = now()
    where usuario = id;
end $$;
revoke all on function public.elio_moderar_resena(uuid, boolean) from public, anon;
grant execute on function public.elio_moderar_resena(uuid, boolean) to authenticated;

-- Comprobación: 4 filas en «true»
select 'resenas_rls' as que, (select rowsecurity from pg_tables where schemaname='public' and tablename='resenas') as ok
union all select 'publico_anon', has_function_privilege('anon', 'public.elio_resenas_publicas()', 'execute')
union all select 'guardar_no_anon', not has_function_privilege('anon', 'public.elio_guardar_resena(int, text, boolean)', 'execute')
union all select 'moderar_2fa', pg_get_functiondef('public.elio_moderar_resena(uuid, boolean)'::regprocedure) like '%elio_es_admin%';

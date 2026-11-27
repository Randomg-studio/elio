-- ELIO · Versión 21 (27-nov-2026): escudo de seguridad, fase 1 (manual EL-SEG-001 v1.0, cap. 16.2 y 21).
--  - Límite técnico por cuenta o invitado: respuestas al mismo tiempo y solicitudes por minuto (no son cupos comerciales).
--  - Registro de eventos de seguridad SIN contenido: código, flujo, motor y fecha (sin texto, sin valores tapados).
--  - Resumen para el dueño (2FA).
-- Se ejecuta en el SQL Editor del proyecto «elio». Se puede repetir sin daño.

create table if not exists public.solicitudes (
  id bigserial primary key,
  clave text not null,                 -- usuario (uuid) o huella anónima del invitado; nunca IP en claro
  inicio timestamptz not null default now(),
  fin timestamptz
);
create index if not exists solicitudes_clave on public.solicitudes (clave, inicio desc);
alter table public.solicitudes enable row level security;   -- sin políticas: solo el servidor

-- Abre una solicitud si no supera los límites. Errores: 'OCUPADO' (ya hay respuestas en curso) o 'RAFAGA' (demasiadas por minuto).
-- Las solicitudes «en curso» de más de 3 minutos se consideran terminadas (por si una función se cortó).
create or replace function public.elio_abrir_solicitud(k text, max_simultaneas int default 2, max_minuto int default 30) returns bigint
language plpgsql security definer set search_path = public as $$
declare n_curso int; n_min int; nuevo bigint;
begin
  perform pg_advisory_xact_lock(hashtext('solicitud:' || k));
  select count(*) into n_curso from public.solicitudes where clave = k and fin is null and inicio > now() - interval '3 minutes';
  if n_curso >= max_simultaneas then raise exception 'OCUPADO'; end if;
  select count(*) into n_min from public.solicitudes where clave = k and inicio > now() - interval '1 minute';
  if n_min >= max_minuto then raise exception 'RAFAGA'; end if;
  insert into public.solicitudes (clave) values (k) returning id into nuevo;
  -- limpieza liviana: borra lo de más de 1 día
  delete from public.solicitudes where inicio < now() - interval '1 day' and id % 50 = 0;
  return nuevo;
end $$;
revoke all on function public.elio_abrir_solicitud(text, int, int) from public, anon, authenticated;

create or replace function public.elio_cerrar_solicitud(s bigint) returns void
language sql security definer set search_path = public as $$
  update public.solicitudes set fin = now() where id = s and fin is null
$$;
revoke all on function public.elio_cerrar_solicitud(bigint) from public, anon, authenticated;

-- Eventos de seguridad: nunca guardan el mensaje ni el dato tapado.
create table if not exists public.eventos_seguridad (
  id bigserial primary key,
  creado timestamptz not null default now(),
  usuario uuid references auth.users on delete set null,   -- null = invitado
  flujo text not null check (flujo in ('chat','invitado','biblioteca','memoria','logrin','admin')),
  codigo text not null check (codigo in ('SECRET_BLOCK','PRIVACY_REDACT','RATE_LIMIT','BUSY_LIMIT','OUTPUT_BLOCK','CANARY_LEAK','CRISIS_SUPPORT','FILE_REJECT','ACCESS_DENIED','POLICY_UNAVAILABLE')),
  motor text,
  detalle text check (detalle is null or length(detalle) <= 80),   -- solo categorías (p. ej. «tarjeta,documento»), nunca valores
  version text not null default 'EL-SEG-001-v1.0'
);
create index if not exists eventos_seg_creado on public.eventos_seguridad (creado desc);
alter table public.eventos_seguridad enable row level security;   -- sin políticas: solo el servidor y el resumen del admin

create or replace function public.elio_admin_seguridad() returns json
language plpgsql stable security definer set search_path = public as $$
declare desde timestamptz := now() - interval '7 days';
begin
  if not public.elio_es_admin() then raise exception 'Solo administradores'; end if;
  return json_build_object(
    'total', (select count(*) from public.eventos_seguridad where creado >= desde),
    'por_codigo', coalesce((select json_agg(x) from (select codigo, flujo, count(*) n, count(distinct usuario) personas from public.eventos_seguridad where creado >= desde group by codigo, flujo order by count(*) desc) x), '[]'::json),
    'canario', (select count(*) from public.eventos_seguridad where codigo = 'CANARY_LEAK' and creado >= desde)
  );
end $$;
revoke all on function public.elio_admin_seguridad() from public, anon;
grant execute on function public.elio_admin_seguridad() to authenticated;

-- Retención propuesta (manual 18.4): eventos de seguridad 90 días.
create or replace function public.elio_limpiar_eventos() returns void
language sql security definer set search_path = public as $$
  delete from public.eventos_seguridad where creado < now() - interval '90 days'
$$;
revoke all on function public.elio_limpiar_eventos() from public, anon, authenticated;

-- Comprobación: 5 filas en «true»
select 'solicitudes_rls' as que, (select rowsecurity from pg_tables where schemaname='public' and tablename='solicitudes') as ok
union all select 'eventos_rls', (select rowsecurity from pg_tables where schemaname='public' and tablename='eventos_seguridad')
union all select 'abrir_cerrado', not has_function_privilege('authenticated', 'public.elio_abrir_solicitud(text, integer, integer)', 'execute')
union all select 'anon_sin_abrir', not has_function_privilege('anon', 'public.elio_abrir_solicitud(text, integer, integer)', 'execute')
union all select 'resumen_2fa', pg_get_functiondef('public.elio_admin_seguridad()'::regprocedure) like '%elio_es_admin%';

-- ELIO · Versión 13 (26-nov-2026): plan Libre nuevo (aprobado por el usuario).
--  - Libre: 10 créditos cada 5 h y 40 por semana, solo Chispa.
--  - Probadita: 3 mensajes con Órbita gratis por semana (no gastan los créditos de Libre; solo mensajes cortos).
--  - Biblioteca 3 documentos (en la función) y Trabajos académicos 10 referencias.
--  - 3 días de Impulso gratis, UNA sola vez por persona, con control contra abuso (cuenta, dispositivo y conexión).
-- Se ejecuta en el SQL Editor del proyecto «elio». Se puede repetir sin daño.

-- Nuevos límites de Libre
create or replace function public.elio_limites(p text) returns json
language sql immutable as $$
  select case p
    when 'ultra' then '{"ventana":150,"semana":780,"motores":["chispa","pulso","orbita","cumbre"]}'::json
    when 'impulso' then '{"ventana":60,"semana":340,"motores":["chispa","pulso","orbita"]}'::json
    else '{"ventana":10,"semana":40,"motores":["chispa"]}'::json end
$$;

-- La probadita se anota aparte (no cuenta en la ventana ni en la semana de créditos)
alter table public.consumo drop constraint if exists consumo_funcion_check;
alter table public.consumo add constraint consumo_funcion_check check (funcion in ('chat','invitado','biblioteca','busqueda','imagen','probadita'));

-- Estado de créditos (agrega la probadita y la prueba gratis)
create or replace function public.elio_creditos(u uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare p text := public.elio_plan(u); l json := public.elio_limites(p);
  v int; s int; prox timestamptz; ini timestamptz := public.elio_inicio_semana(); prob int;
begin
  select coalesce(sum(creditos), 0), min(creado) + interval '5 hours' into v, prox
    from public.consumo where usuario = u and funcion = 'chat' and creado > now() - interval '5 hours';
  select coalesce(sum(creditos), 0) into s from public.consumo where usuario = u and funcion = 'chat' and creado >= ini;
  select count(*) into prob from public.consumo where usuario = u and funcion = 'probadita' and creado >= ini;
  return json_build_object('plan', p, 'motores', l->'motores',
    'ventana_max', (l->>'ventana')::int, 'ventana_usado', v, 'ventana_renueva', prox,
    'semana_max', (l->>'semana')::int, 'semana_usado', s, 'semana_renueva', ini + interval '7 days',
    'probadita_restante', case when p = 'libre' then greatest(0, 3 - prob) else 0 end,
    'prueba_disponible', p = 'libre' and not exists (select 1 from public.pruebas_gratis where usuario = u),
    'encuesta', coalesce((select encuesta_hecha from public.perfiles where id = u), false));
end $$;
revoke all on function public.elio_creditos(uuid) from public, anon, authenticated;

-- Reserva: Libre puede usar Órbita solo con la probadita (3 por semana)
create or replace function public.elio_reservar(u uuid, m text, cr int) returns bigint
language plpgsql security definer set search_path = public as $$
declare e json; nid bigint;
begin
  perform pg_advisory_xact_lock(hashtext('elio_creditos_' || u::text));
  e := public.elio_creditos(u);
  if e->>'plan' = 'libre' and m = 'orbita' then
    if (e->>'probadita_restante')::int <= 0 then raise exception 'PROBADITA|%', e->>'semana_renueva'; end if;
    insert into public.consumo (usuario, motor, funcion, creditos) values (u, m, 'probadita', 0) returning consumo.id into nid;
    return nid;
  end if;
  if not (e->'motores')::jsonb ? m then raise exception 'MOTOR|%', e->>'plan'; end if;
  if (e->>'ventana_usado')::int + cr > (e->>'ventana_max')::int then raise exception 'VENTANA|%', coalesce(e->>'ventana_renueva', ''); end if;
  if (e->>'semana_usado')::int + cr > (e->>'semana_max')::int then raise exception 'SEMANA|%', e->>'semana_renueva'; end if;
  insert into public.consumo (usuario, motor, funcion, creditos) values (u, m, 'chat', cr) returning consumo.id into nid;
  return nid;
end $$;
revoke all on function public.elio_reservar(uuid, text, int) from public, anon, authenticated;

-- ---------- 3 días de Impulso gratis, una sola vez ----------
create table if not exists public.pruebas_gratis (
  usuario uuid primary key references auth.users on delete cascade,
  dispositivo text not null,            -- código del navegador o celular (se guarda con hash)
  huella_ip text not null,              -- hash de la conexión (no se guarda la IP)
  creado timestamptz not null default now()
);
create unique index if not exists pruebas_dispositivo on public.pruebas_gratis (dispositivo);
alter table public.pruebas_gratis enable row level security;   -- sin políticas: nadie la lee desde la web

create or replace function public.elio_activar_prueba(dispositivo text) returns json
language plpgsql security definer set search_path = public as $$
declare
  u uuid := auth.uid();
  hdr json := coalesce(nullif(current_setting('request.headers', true), '')::json, '{}'::json);
  ip text := split_part(coalesce(hdr->>'cf-connecting-ip', hdr->>'x-forwarded-for', 'sin-ip'), ',', 1);
  hip text := encode(extensions.digest('elio-prueba|' || ip, 'sha256'), 'hex');
  hdis text := encode(extensions.digest('elio-dispositivo|' || coalesce(dispositivo, ''), 'sha256'), 'hex');
  vence date := public.elio_hoy() + 2;   -- hoy y 2 días más = 3 días
begin
  if u is null then raise exception 'Inicia sesión para activar tu prueba.'; end if;
  if length(coalesce(dispositivo, '')) < 16 then raise exception 'No se pudo identificar tu dispositivo. Recarga la página e inténtalo de nuevo.'; end if;
  if public.elio_plan(u) <> 'libre' then raise exception 'La prueba gratis es para cuentas en el plan Libre.'; end if;
  if (select email_confirmed_at from auth.users where id = u) is null then raise exception 'Confirma tu correo antes de activar la prueba.'; end if;
  if exists (select 1 from public.pruebas_gratis where usuario = u) then raise exception 'Ya usaste tu prueba gratis de Impulso.'; end if;
  if exists (select 1 from public.pruebas_gratis where dispositivo = hdis) then raise exception 'En este dispositivo ya se usó una prueba gratis.'; end if;
  if (select count(*) from public.pruebas_gratis where huella_ip = hip and creado > now() - interval '30 days') >= 3 then
    raise exception 'Desde esta conexión ya se activaron varias pruebas este mes.';
  end if;
  insert into public.pruebas_gratis (usuario, dispositivo, huella_ip) values (u, hdis, hip);
  update public.perfiles set plan = 'impulso', plan_vence = vence where id = u;
  return json_build_object('plan', 'impulso', 'vence', vence);
end $$;
revoke all on function public.elio_activar_prueba(text) from public, anon;
grant execute on function public.elio_activar_prueba(text) to authenticated;

-- Trabajos académicos en Libre: 10 referencias
create or replace function public.elio_cupo_referencias() returns trigger
language plpgsql security definer set search_path = public as $$
declare tope int := (case public.elio_plan(new.usuario) when 'ultra' then 1000 when 'impulso' then 300 else 10 end);
begin
  if (select count(*) from public.referencias where usuario = new.usuario) >= tope then
    raise exception 'Llegaste a % referencias guardadas, el máximo de tu plan. Borra alguna o sube de plan.', tope;
  end if;
  return new;
end $$;

-- Comprobación: 4 filas en «true»
select 'libre_10_40' as que, (public.elio_limites('libre')->>'ventana')::int = 10 and (public.elio_limites('libre')->>'semana')::int = 40 as ok
union all select 'probadita', pg_get_functiondef('public.elio_reservar(uuid, text, int)'::regprocedure) like '%PROBADITA%'
union all select 'prueba_rls', (select rowsecurity from pg_tables where schemaname='public' and tablename='pruebas_gratis')
union all select 'prueba_funcion', has_function_privilege('authenticated', 'public.elio_activar_prueba(text)', 'execute');

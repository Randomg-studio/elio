-- ELIO · Versión 10 (26-nov-2026): motores con nombre propio, créditos por ventana de 5 horas y por semana,
-- medición del consumo por función y motor, y encuesta para conocer al público.
--  Motores (créditos por mensaje): Chispa 1 · Pulso 2 · Órbita 10 · Cumbre 25.  1 crédito ≈ US$ 0,0025 de costo máximo.
--  Límites (cada 5 h / por semana): Libre 20/100 (solo Chispa) · Impulso 60/340 (Chispa, Pulso, Órbita) · Ultra 150/780 (los 4).
--  La semana empieza el lunes a las 00:00 de Lima.
-- Se ejecuta en el SQL Editor del proyecto «elio». Se puede repetir sin daño.

-- ---------- Consumo (todo lo que gasta IA, para medir y para los créditos) ----------
create table if not exists public.consumo (
  id bigserial primary key,
  usuario uuid references auth.users on delete cascade,   -- null = invitado
  motor text not null check (motor in ('chispa','pulso','orbita','cumbre','gemini')),
  funcion text not null check (funcion in ('chat','invitado','biblioteca','busqueda','imagen')),
  creditos int not null default 0,
  costo_usd numeric(12,6) not null default 0,
  creado timestamptz not null default now()
);
create index if not exists consumo_usuario on public.consumo (usuario, creado desc);
create index if not exists consumo_creado on public.consumo (creado desc);
alter table public.consumo enable row level security;
drop policy if exists "consumo propio" on public.consumo;
create policy "consumo propio" on public.consumo for select using (usuario = auth.uid());

create or replace function public.elio_limites(p text) returns json
language sql immutable as $$
  select case p
    when 'ultra' then '{"ventana":150,"semana":780,"motores":["chispa","pulso","orbita","cumbre"]}'::json
    when 'impulso' then '{"ventana":60,"semana":340,"motores":["chispa","pulso","orbita"]}'::json
    else '{"ventana":20,"semana":100,"motores":["chispa"]}'::json end
$$;

create or replace function public.elio_inicio_semana() returns timestamptz
language sql stable as $$
  select (date_trunc('week', now() at time zone 'America/Lima')) at time zone 'America/Lima'
$$;

-- Estado de créditos de una persona (lo usa la web para el medidor y el servidor para decidir)
create or replace function public.elio_creditos(u uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare p text := public.elio_plan(u); l json := public.elio_limites(p);
  v int; s int; prox timestamptz; ini timestamptz := public.elio_inicio_semana();
begin
  select coalesce(sum(creditos), 0), min(creado) + interval '5 hours' into v, prox
    from public.consumo where usuario = u and funcion = 'chat' and creado > now() - interval '5 hours';
  select coalesce(sum(creditos), 0) into s from public.consumo where usuario = u and funcion = 'chat' and creado >= ini;
  return json_build_object('plan', p, 'motores', l->'motores',
    'ventana_max', (l->>'ventana')::int, 'ventana_usado', v, 'ventana_renueva', prox,
    'semana_max', (l->>'semana')::int, 'semana_usado', s, 'semana_renueva', ini + interval '7 days',
    'encuesta', coalesce((select encuesta_hecha from public.perfiles where id = u), false));
end $$;
revoke all on function public.elio_creditos(uuid) from public, anon, authenticated;

create or replace function public.elio_mis_creditos() returns json
language sql stable security definer set search_path = public as $$ select public.elio_creditos(auth.uid()) $$;
revoke all on function public.elio_mis_creditos() from public, anon;
grant execute on function public.elio_mis_creditos() to authenticated;

-- Reserva créditos ANTES de responder (atómico por persona). Devuelve el id del consumo o lanza un error claro.
create or replace function public.elio_reservar(u uuid, m text, cr int) returns bigint
language plpgsql security definer set search_path = public as $$
declare e json; nid bigint;
begin
  perform pg_advisory_xact_lock(hashtext('elio_creditos_' || u::text));
  e := public.elio_creditos(u);
  if not (e->'motores')::jsonb ? m then raise exception 'MOTOR|%', e->>'plan'; end if;
  if (e->>'ventana_usado')::int + cr > (e->>'ventana_max')::int then raise exception 'VENTANA|%', coalesce(e->>'ventana_renueva', ''); end if;
  if (e->>'semana_usado')::int + cr > (e->>'semana_max')::int then raise exception 'SEMANA|%', e->>'semana_renueva'; end if;
  insert into public.consumo (usuario, motor, funcion, creditos) values (u, m, 'chat', cr) returning consumo.id into nid;
  return nid;
end $$;
revoke all on function public.elio_reservar(uuid, text, int) from public, anon, authenticated;

-- Devuelve créditos si la respuesta falló, o anota el costo real
create or replace function public.elio_cerrar_consumo(c bigint, costo numeric, devolver boolean) returns void
language sql security definer set search_path = public as $$
  update public.consumo set costo_usd = costo, creditos = case when devolver then 0 else creditos end where id = c
$$;
revoke all on function public.elio_cerrar_consumo(bigint, numeric, boolean) from public, anon, authenticated;

-- Anota consumo sin créditos (invitados, Biblioteca, Mi día…)
create or replace function public.elio_anotar_consumo(u uuid, m text, f text, costo numeric) returns void
language sql security definer set search_path = public as $$
  insert into public.consumo (usuario, motor, funcion, creditos, costo_usd) values (u, m, f, 0, costo)
$$;
revoke all on function public.elio_anotar_consumo(uuid, text, text, numeric) from public, anon, authenticated;

-- La Biblioteca, Mi día, aprendizajes y memorias ya suman su costo aquí: ahora también quedan en «consumo»
create or replace function public.elio_sumar_biblioteca(u uuid, preguntas int, paginas int, costo numeric, es_libre boolean) returns void
language plpgsql security definer set search_path = public as $$
declare d date := public.elio_hoy();
begin
  insert into public.uso (usuario, dia) values (u, d) on conflict do nothing;
  update public.uso set preguntas_biblioteca = preguntas_biblioteca + preguntas, paginas_leidas = paginas_leidas + paginas,
    costo_usd = costo_usd + costo where usuario = u and dia = d;
  insert into public.gasto_dia (dia) values (d) on conflict do nothing;
  update public.gasto_dia set total_usd = total_usd + costo, biblioteca_usd = biblioteca_usd + costo,
    libre_usd = libre_usd + case when es_libre then costo else 0 end where dia = d;
  if costo > 0 then insert into public.consumo (usuario, motor, funcion, creditos, costo_usd) values (u, 'chispa', 'biblioteca', 0, costo); end if;
end $$;
revoke all on function public.elio_sumar_biblioteca(uuid, int, int, numeric, boolean) from public, anon, authenticated;

-- ---------- Encuesta ----------
alter table public.perfiles add column if not exists encuesta_hecha boolean not null default false;

create table if not exists public.encuesta (
  id bigserial primary key,
  usuario uuid references auth.users on delete set null,   -- solo si la persona lo permitió
  huella text not null,                                    -- huella anónima (no se guarda la IP)
  usa text[] not null default '{}',
  para text[] not null default '{}',
  falta text[] not null default '{}',
  pagaria text,
  comentario text check (length(comentario) <= 500),
  creado timestamptz not null default now()
);
create index if not exists encuesta_creado on public.encuesta (creado desc);
alter table public.encuesta enable row level security;   -- sin políticas: nadie la lee desde la web

create or replace function public.elio_encuesta_responder(usa text[], para text[], falta text[], pagaria text, comentario text, vincular boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  hdr json := coalesce(nullif(current_setting('request.headers', true), '')::json, '{}'::json);
  ip text := split_part(coalesce(hdr->>'cf-connecting-ip', hdr->>'x-forwarded-for', 'sin-ip'), ',', 1);
  h text := encode(extensions.digest('elio-encuesta|' || ip || '|' || public.elio_hoy()::text, 'sha256'), 'hex');
  ok_usa text[] := array['chatgpt','gemini','claude','copilot','meta','ninguna','otra'];
  ok_para text[] := array['estudiar','trabajo','redactar','investigar','imagenes','programar','organizar','negocio','otra'];
  ok_falta text[] := array['web','investigacion','imagenes','documentos','recordatorios','voz','video','otra'];
  ok_pago text[] := array['no','hasta20','20a40','40a90','mas90'];
  u uuid := auth.uid();
begin
  if (select count(*) from public.encuesta where huella = h) >= 20 then raise exception 'Demasiadas respuestas desde esta conexión hoy.'; end if;
  if u is not null and (select encuesta_hecha from public.perfiles where id = u) then return; end if;
  insert into public.encuesta (usuario, huella, usa, para, falta, pagaria, comentario)
  values (
    case when vincular and u is not null and coalesce((select aprende from public.perfiles where id = u), false) then u end,
    h,
    (select coalesce(array_agg(x), '{}') from unnest(usa) x where x = any(ok_usa)),
    (select coalesce(array_agg(x), '{}') from (select x from unnest(para) x where x = any(ok_para) limit 3) t),
    (select coalesce(array_agg(x), '{}') from (select x from unnest(falta) x where x = any(ok_falta) limit 3) t),
    case when pagaria = any(ok_pago) then pagaria end,
    nullif(left(trim(coalesce(comentario, '')), 500), ''));
  if u is not null then update public.perfiles set encuesta_hecha = true where id = u; end if;
end $$;
revoke all on function public.elio_encuesta_responder(text[], text[], text[], text, text, boolean) from public;
grant execute on function public.elio_encuesta_responder(text[], text[], text[], text, text, boolean) to anon, authenticated;

create or replace function public.elio_encuesta_cerrar() returns void
language sql security definer set search_path = public as $$ update public.perfiles set encuesta_hecha = true where id = auth.uid() $$;
revoke all on function public.elio_encuesta_cerrar() from public, anon;
grant execute on function public.elio_encuesta_cerrar() to authenticated;

-- ---------- Panel del administrador (con 2FA) ----------
create or replace function public.elio_admin_consumo() returns json
language plpgsql stable security definer set search_path = public as $$
declare desde timestamptz := now() - interval '7 days';
begin
  if not public.elio_es_admin() then raise exception 'Solo administradores'; end if;
  return json_build_object(
    'por_funcion', (select coalesce(json_agg(x order by x.costo desc), '[]'::json) from (
       select funcion, motor, count(*) n, sum(creditos) creditos, round(sum(costo_usd), 4) costo
       from public.consumo where creado > desde group by 1, 2) x),
    'por_plan', (select coalesce(json_agg(x), '[]'::json) from (
       select public.elio_plan(usuario) plan, count(distinct usuario) personas, round(sum(costo_usd), 4) costo
       from public.consumo where creado > desde and usuario is not null group by 1) x));
end $$;
revoke all on function public.elio_admin_consumo() from public, anon;
grant execute on function public.elio_admin_consumo() to authenticated;

create or replace function public.elio_admin_encuesta() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.elio_es_admin() then raise exception 'Solo administradores'; end if;
  return json_build_object(
    'total', (select count(*) from public.encuesta),
    'usa', (select coalesce(json_agg(x), '[]'::json) from (select v nombre, count(*) n from public.encuesta, unnest(usa) v group by 1 order by 2 desc) x),
    'para', (select coalesce(json_agg(x), '[]'::json) from (select v nombre, count(*) n from public.encuesta, unnest(para) v group by 1 order by 2 desc) x),
    'falta', (select coalesce(json_agg(x), '[]'::json) from (select v nombre, count(*) n from public.encuesta, unnest(falta) v group by 1 order by 2 desc) x),
    'pagaria', (select coalesce(json_agg(x), '[]'::json) from (select pagaria nombre, count(*) n from public.encuesta where pagaria is not null group by 1 order by 2 desc) x),
    'comentarios', (select coalesce(json_agg(x), '[]'::json) from (select comentario, creado from public.encuesta where comentario is not null order by creado desc limit 30) x),
    'csv', (select coalesce(string_agg(format('%s;%s;%s;%s;%s;"%s"', to_char(creado, 'YYYY-MM-DD'), array_to_string(usa, ','), array_to_string(para, ','),
              array_to_string(falta, ','), coalesce(pagaria, ''), replace(coalesce(comentario, ''), '"', '''')), E'\n' order by creado), '') from public.encuesta));
end $$;
revoke all on function public.elio_admin_encuesta() from public, anon;
grant execute on function public.elio_admin_encuesta() to authenticated;

-- Resumen semanal de la encuesta a pagos@ (lunes 9:00 de Lima = 14:00 UTC), sin IA
create or replace function public.elio_resumen_encuesta() returns void
language plpgsql security definer set search_path = '' as $$
declare n int; top_usa text; top_para text; top_falta text;
begin
  select count(*) into n from public.encuesta where creado > now() - interval '7 days';
  if n = 0 then return; end if;
  select string_agg(v || ' (' || c || ')', ', ') into top_usa from (select v, count(*) c from public.encuesta, unnest(usa) v where creado > now() - interval '7 days' group by 1 order by 2 desc limit 3) x;
  select string_agg(v || ' (' || c || ')', ', ') into top_para from (select v, count(*) c from public.encuesta, unnest(para) v where creado > now() - interval '7 days' group by 1 order by 2 desc limit 3) x;
  select string_agg(v || ' (' || c || ')', ', ') into top_falta from (select v, count(*) c from public.encuesta, unnest(falta) v where creado > now() - interval '7 days' group by 1 order by 2 desc limit 3) x;
  perform public.elio_correo('pagos@flexgogroup.com', 'Elio · Encuesta de la semana: ' || n || ' respuestas',
    '<div style="font-family:Arial,Helvetica,sans-serif;color:#102449"><p>Respuestas de los últimos 7 días: <b>' || n || '</b></p><ul><li><b>Qué IA usan:</b> ' || public.elio_html(coalesce(top_usa, '—'))
      || '</li><li><b>Para qué:</b> ' || public.elio_html(coalesce(top_para, '—')) || '</li><li><b>Qué les falta:</b> ' || public.elio_html(coalesce(top_falta, '—'))
      || '</li></ul><p>Detalle y comentarios en el panel de Elio.</p><p>Elio by FlexGo Group</p></div>',
    'Respuestas de los últimos 7 días: ' || n || E'\nQué IA usan: ' || coalesce(top_usa, '—') || E'\nPara qué: ' || coalesce(top_para, '—')
      || E'\nQué les falta: ' || coalesce(top_falta, '—') || E'\n\nDetalle en el panel de Elio.', 'elio-encuesta');
end $$;
revoke all on function public.elio_resumen_encuesta() from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'elio-resumen-encuesta';
select cron.schedule('elio-resumen-encuesta', '0 14 * * 1', 'select public.elio_resumen_encuesta()');

-- Comprobación: 5 filas en «true»
select 'consumo_rls' as que, (select rowsecurity from pg_tables where schemaname='public' and tablename='consumo') as ok
union all select 'reservar_cerrado', not has_function_privilege('authenticated', 'public.elio_reservar(uuid, text, int)', 'execute')
union all select 'encuesta_rls', (select rowsecurity from pg_tables where schemaname='public' and tablename='encuesta')
union all select 'encuesta_anon', has_function_privilege('anon', 'public.elio_encuesta_responder(text[], text[], text[], text, text, boolean)', 'execute')
union all select 'resumen_semanal', exists(select 1 from cron.job where jobname = 'elio-resumen-encuesta');

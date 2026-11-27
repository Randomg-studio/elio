-- ELIO · Versión 15 (26-nov-2026): Ultra para 2 personas y control de dispositivos.
--  - El titular de Ultra invita a 1 persona por correo; cada una con su cuenta y su espacio privado.
--  - Los créditos de Ultra se dividen en partes iguales cuando hay 2 personas: 75 cada 5 h y 390 por semana para cada una.
--  - Dispositivos: Libre 2 · Impulso 3 · Ultra 2 por persona (4 en total). El servidor revisa el dispositivo en cada mensaje.
-- Se ejecuta en el SQL Editor del proyecto «elio». Se puede repetir sin daño.

-- ---------- Cuenta compartida de Ultra ----------
create table if not exists public.ultra_compartido (
  titular uuid primary key references auth.users on delete cascade,
  invitado uuid unique references auth.users on delete set null,
  invitado_email text not null check (length(invitado_email) between 5 and 200),
  codigo_hash text not null,
  estado text not null default 'pendiente' check (estado in ('pendiente','activa')),
  creado timestamptz not null default now()
);
alter table public.ultra_compartido enable row level security;
drop policy if exists "compartido propio" on public.ultra_compartido;
create policy "compartido propio" on public.ultra_compartido for select using (titular = auth.uid() or invitado = auth.uid());

-- Plan propio (sin contar la cuenta compartida)
create or replace function public.elio_plan_propio(u uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when p.plan <> 'libre' and (p.plan_vence is null or p.plan_vence < public.elio_hoy()) then 'libre' else p.plan end
  from public.perfiles p where p.id = u
$$;
revoke all on function public.elio_plan_propio(uuid) from public, anon, authenticated;

-- Plan efectivo: el suyo, o Ultra si es la 2.ª persona de un Ultra vigente
create or replace function public.elio_plan(u uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when public.elio_plan_propio(u) <> 'libre' then public.elio_plan_propio(u)
    when exists (select 1 from public.ultra_compartido c where c.invitado = u and c.estado = 'activa' and public.elio_plan_propio(c.titular) = 'ultra') then 'ultra'
    else 'libre' end
$$;
revoke all on function public.elio_plan(uuid) from public, anon, authenticated;

-- ¿Comparte Ultra? (titular con invitado activo, o invitado activo)
create or replace function public.elio_comparte(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.ultra_compartido c where c.estado = 'activa' and c.invitado is not null and (c.titular = u or c.invitado = u))
$$;
revoke all on function public.elio_comparte(uuid) from public, anon, authenticated;

-- Créditos: en Ultra compartido, la mitad para cada persona
create or replace function public.elio_creditos(u uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare p text := public.elio_plan(u); l json := public.elio_limites(p);
  vmax int := (l->>'ventana')::int; smax int := (l->>'semana')::int; comp boolean := false;
  v int; s int; prox timestamptz; ini timestamptz := public.elio_inicio_semana(); prob int;
begin
  if p = 'ultra' and public.elio_comparte(u) then vmax := vmax / 2; smax := smax / 2; comp := true; end if;
  select coalesce(sum(creditos), 0), min(creado) + interval '5 hours' into v, prox
    from public.consumo where usuario = u and funcion = 'chat' and creado > now() - interval '5 hours';
  select coalesce(sum(creditos), 0) into s from public.consumo where usuario = u and funcion = 'chat' and creado >= ini;
  select count(*) into prob from public.consumo where usuario = u and funcion = 'probadita' and creado >= ini;
  return json_build_object('plan', p, 'motores', l->'motores', 'compartido', comp,
    'ventana_max', vmax, 'ventana_usado', v, 'ventana_renueva', prox,
    'semana_max', smax, 'semana_usado', s, 'semana_renueva', ini + interval '7 days',
    'probadita_restante', case when p = 'libre' then greatest(0, 3 - prob) else 0 end,
    'prueba_disponible', p = 'libre' and not exists (select 1 from public.pruebas_gratis where usuario = u),
    'titular_ultra', public.elio_plan_propio(u) = 'ultra',
    'dispositivos_max', public.elio_max_dispositivos(u),
    'encuesta', coalesce((select encuesta_hecha from public.perfiles where id = u), false));
end $$;
revoke all on function public.elio_creditos(uuid) from public, anon, authenticated;

-- Invitar (solo el titular de un Ultra vigente). Devuelve el código para el enlace; se envía por correo.
create or replace function public.elio_invitar_ultra(correo text) returns json
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); cod text := encode(extensions.gen_random_bytes(18), 'hex'); mi text;
begin
  if public.elio_plan_propio(u) <> 'ultra' then raise exception 'Solo el titular de un plan Ultra puede invitar.'; end if;
  correo := lower(trim(correo));
  if correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Escribe un correo válido.'; end if;
  select lower(email) into mi from auth.users where id = u;
  if correo = mi then raise exception 'No puedes invitarte a ti mismo.'; end if;
  if exists (select 1 from public.ultra_compartido where titular = u and estado = 'activa') then raise exception 'Ya compartes tu Ultra. Quita a la persona actual para invitar a otra.'; end if;
  if exists (select 1 from public.ultra_compartido where titular = u and estado = 'pendiente' and creado > now() - interval '10 minutes') then raise exception 'Ya enviaste una invitación hace poco. Espera unos minutos para reenviarla.'; end if;
  insert into public.ultra_compartido (titular, invitado_email, codigo_hash, estado, invitado)
  values (u, correo, encode(extensions.digest(cod, 'sha256'), 'hex'), 'pendiente', null)
  on conflict (titular) do update set invitado_email = excluded.invitado_email, codigo_hash = excluded.codigo_hash, estado = 'pendiente', invitado = null, creado = now();
  perform public.elio_correo(correo, 'Te invitaron a compartir Elio Ultra',
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#102449;line-height:1.55"><p>Hola,</p><p>Te invitaron a usar <b>Elio Ultra</b> (la IA de FlexGo Group) con tu propia cuenta y tu espacio privado.</p><p><a href="https://elio.flexgogroup.com/?invitacion='
      || cod || '" style="display:inline-block;background:#0756d8;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Aceptar invitación</a></p><p style="font-size:12px;color:#5b6b85">Entra o crea tu cuenta con este mismo correo. Si no esperabas este correo, ignóralo.</p><p>Elio by FlexGo Group</p></div>',
    E'Hola,\n\nTe invitaron a usar Elio Ultra con tu propia cuenta.\nAcepta aquí (entra o crea tu cuenta con este mismo correo):\nhttps://elio.flexgogroup.com/?invitacion=' || cod || E'\n\nElio by FlexGo Group', 'elio-invitacion');
  return json_build_object('ok', true, 'correo', correo);
end $$;
revoke all on function public.elio_invitar_ultra(text) from public, anon;
grant execute on function public.elio_invitar_ultra(text) to authenticated;

create or replace function public.elio_aceptar_ultra(codigo text) returns json
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); r public.ultra_compartido; mi text;
begin
  select * into r from public.ultra_compartido where codigo_hash = encode(extensions.digest(coalesce(codigo, ''), 'sha256'), 'hex') and estado = 'pendiente';
  if not found then raise exception 'Esta invitación no existe o ya fue usada.'; end if;
  select lower(email) into mi from auth.users where id = u;
  if mi <> r.invitado_email then raise exception 'Esta invitación es para otro correo. Entra con el correo invitado.'; end if;
  if r.titular = u then raise exception 'No puedes aceptar tu propia invitación.'; end if;
  if exists (select 1 from public.ultra_compartido where invitado = u and estado = 'activa') then raise exception 'Ya compartes otro plan Ultra.'; end if;
  update public.ultra_compartido set invitado = u, estado = 'activa' where titular = r.titular;
  return json_build_object('ok', true);
end $$;
revoke all on function public.elio_aceptar_ultra(text) from public, anon;
grant execute on function public.elio_aceptar_ultra(text) to authenticated;

-- El titular quita a la persona, o la persona sale
create or replace function public.elio_salir_ultra() returns void
language sql security definer set search_path = public as $$
  delete from public.ultra_compartido where titular = auth.uid() or invitado = auth.uid()
$$;
revoke all on function public.elio_salir_ultra() from public, anon;
grant execute on function public.elio_salir_ultra() to authenticated;

create or replace function public.elio_mi_compartido() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'soy_titular', c.titular = auth.uid(), 'estado', c.estado, 'correo', c.invitado_email,
    'titular_nombre', (select nombre from public.perfiles where id = c.titular),
    'invitado_nombre', (select nombre from public.perfiles where id = c.invitado))
  from public.ultra_compartido c where c.titular = auth.uid() or c.invitado = auth.uid() limit 1
$$;
revoke all on function public.elio_mi_compartido() from public, anon;
grant execute on function public.elio_mi_compartido() to authenticated;

-- ---------- Dispositivos ----------
create table if not exists public.dispositivos (
  id bigserial primary key,
  usuario uuid not null references auth.users on delete cascade,
  codigo_hash text not null,
  nombre text not null default 'Dispositivo' check (length(nombre) <= 80),
  activo boolean not null default true,
  creado timestamptz not null default now(),
  ultimo timestamptz not null default now(),
  unique (usuario, codigo_hash)
);
alter table public.dispositivos enable row level security;
drop policy if exists "dispositivos propios" on public.dispositivos;
create policy "dispositivos propios" on public.dispositivos for select using (usuario = auth.uid());

create or replace function public.elio_max_dispositivos(u uuid) returns int
language sql stable security definer set search_path = public as $$
  select case public.elio_plan(u) when 'ultra' then 2 when 'impulso' then 3 else 2 end
$$;
revoke all on function public.elio_max_dispositivos(uuid) from public, anon, authenticated;

-- Registrar o revisar este dispositivo (al abrir Elio). Si se pasa del límite, devuelve la lista para cerrar uno.
create or replace function public.elio_mi_dispositivo(dispositivo text, nombre text) returns json
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); h text := encode(extensions.digest('elio-disp|' || coalesce(dispositivo, ''), 'sha256'), 'hex');
  d public.dispositivos; maxd int := public.elio_max_dispositivos(u); n int;
begin
  if u is null or length(coalesce(dispositivo, '')) < 16 then raise exception 'Dispositivo no válido.'; end if;
  select * into d from public.dispositivos where usuario = u and codigo_hash = h;
  if found then
    if not d.activo then return json_build_object('ok', false, 'motivo', 'cerrado'); end if;
    update public.dispositivos set ultimo = now(), nombre = left(coalesce(nullif(nombre, ''), d.nombre), 80) where id = d.id;
    return json_build_object('ok', true, 'id', d.id);
  end if;
  if (select count(*) from public.dispositivos where usuario = u and creado > now() - interval '1 hour') >= 10 then raise exception 'Demasiados dispositivos nuevos en la última hora.'; end if;
  select count(*) into n from public.dispositivos where usuario = u and activo;
  if n >= maxd then
    return json_build_object('ok', false, 'motivo', 'limite', 'max', maxd);
  end if;
  insert into public.dispositivos (usuario, codigo_hash, nombre) values (u, h, left(coalesce(nullif(nombre, ''), 'Dispositivo'), 80)) returning * into d;
  return json_build_object('ok', true, 'id', d.id);
end $$;
revoke all on function public.elio_mi_dispositivo(text, text) from public, anon;
grant execute on function public.elio_mi_dispositivo(text, text) to authenticated;

-- Cerrar la sesión de un dispositivo (desde «Mis dispositivos»)
create or replace function public.elio_cerrar_dispositivo(d bigint) returns void
language sql security definer set search_path = public as $$
  update public.dispositivos set activo = false where id = d and usuario = auth.uid()
$$;
revoke all on function public.elio_cerrar_dispositivo(bigint) from public, anon;
grant execute on function public.elio_cerrar_dispositivo(bigint) to authenticated;

-- Para el servidor: ¿este dispositivo puede usar Elio?
create or replace function public.elio_dispositivo_ok(u uuid, dispositivo text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.dispositivos where usuario = u and activo
    and codigo_hash = encode(extensions.digest('elio-disp|' || coalesce(dispositivo, ''), 'sha256'), 'hex'))
$$;
revoke all on function public.elio_dispositivo_ok(uuid, text) from public, anon, authenticated;

-- Comprobación: 5 filas en «true»
select 'compartido_rls' as que, (select rowsecurity from pg_tables where schemaname='public' and tablename='ultra_compartido') as ok
union all select 'dispositivos_rls', (select rowsecurity from pg_tables where schemaname='public' and tablename='dispositivos')
union all select 'plan_compartido', pg_get_functiondef('public.elio_plan(uuid)'::regprocedure) like '%ultra_compartido%'
union all select 'mitad_creditos', pg_get_functiondef('public.elio_creditos(uuid)'::regprocedure) like '%vmax / 2%'
union all select 'disp_servidor', not has_function_privilege('authenticated', 'public.elio_dispositivo_ok(uuid, text)', 'execute');

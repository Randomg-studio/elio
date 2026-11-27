-- ELIO · Versión 17 (26-nov-2026): fase 5 · Mis proyectos (Ultra), ramas y chats fijados.
--  - Proyectos solo en Ultra: hasta 20 por persona y 10 chats por proyecto.
--  - Contraseña opcional por proyecto (cifrada con bcrypt). Al abrirlo queda desbloqueado 30 minutos en esa cuenta.
--    5 intentos fallidos → bloqueado 15 minutos. Si la olvidas: código de 6 números a tu correo (15 minutos).
--  - Los chats de un proyecto cerrado NO se pueden leer (RLS en conversaciones y mensajes) ni seguir (elio-chat).
--  - Ramas (Ultra): copia el chat hasta un mensaje para probar otro camino. Máximo 5 ramas por chat.
--  - Fijar chats (todos los planes): máximo 3.
-- Se ejecuta en el SQL Editor del proyecto «elio». Se puede repetir sin daño.

create table if not exists public.proyectos (
  id uuid primary key default gen_random_uuid(),
  usuario uuid not null references auth.users on delete cascade,
  nombre text not null check (length(nombre) between 1 and 60),
  descripcion text check (length(descripcion) <= 300),
  clave_hash text,                                 -- null = sin contraseña
  intentos int not null default 0,
  bloqueado_hasta timestamptz,
  recuperar_hash text, recuperar_vence timestamptz, recuperar_intentos int not null default 0,
  creado timestamptz not null default now()
);
create index if not exists proyectos_usuario on public.proyectos (usuario, creado desc);
alter table public.proyectos enable row level security;
-- Sin políticas: la web lee los proyectos con elio_mis_proyectos() (nunca ve el hash).

create table if not exists public.proyecto_abierto (
  proyecto uuid primary key references public.proyectos on delete cascade,
  hasta timestamptz not null
);
alter table public.proyecto_abierto enable row level security;

alter table public.conversaciones add column if not exists proyecto uuid references public.proyectos on delete cascade;
alter table public.conversaciones add column if not exists rama_de uuid references public.conversaciones on delete set null;
alter table public.conversaciones add column if not exists fijado boolean not null default false;
create index if not exists conversaciones_proyecto on public.conversaciones (proyecto);

-- ¿Está abierto? (sin contraseña o desbloqueado hace menos de 30 minutos)
create or replace function public.elio_proyecto_abierto_de(u uuid, p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p is null or exists (
    select 1 from public.proyectos x where x.id = p and x.usuario = u
      and (x.clave_hash is null or exists (select 1 from public.proyecto_abierto a where a.proyecto = x.id and a.hasta > now())))
$$;
revoke all on function public.elio_proyecto_abierto_de(uuid, uuid) from public, anon, authenticated;
create or replace function public.elio_proyecto_abierto(p uuid) returns boolean
language sql stable security definer set search_path = public as $$ select public.elio_proyecto_abierto_de(auth.uid(), p) $$;
revoke all on function public.elio_proyecto_abierto(uuid) from public, anon;
grant execute on function public.elio_proyecto_abierto(uuid) to authenticated;

create or replace function public.elio_conv_abierta(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select public.elio_proyecto_abierto_de(auth.uid(), proyecto) from public.conversaciones where id = c and usuario = auth.uid()), false)
$$;
revoke all on function public.elio_conv_abierta(uuid) from public, anon;
grant execute on function public.elio_conv_abierta(uuid) to authenticated;

-- RLS: los chats de un proyecto cerrado no se ven, ni se cambian, ni se borran
drop policy if exists "conv propias ver" on public.conversaciones;
create policy "conv propias ver" on public.conversaciones for select using (usuario = auth.uid() and (proyecto is null or public.elio_proyecto_abierto(proyecto)));
drop policy if exists "conv propias editar" on public.conversaciones;
create policy "conv propias editar" on public.conversaciones for update
  using (usuario = auth.uid() and (proyecto is null or public.elio_proyecto_abierto(proyecto)))
  with check (usuario = auth.uid() and (proyecto is null or public.elio_proyecto_abierto(proyecto)));
drop policy if exists "conv propias borrar" on public.conversaciones;
create policy "conv propias borrar" on public.conversaciones for delete using (usuario = auth.uid() and (proyecto is null or public.elio_proyecto_abierto(proyecto)));
drop policy if exists "mensajes propios ver" on public.mensajes;
create policy "mensajes propios ver" on public.mensajes for select using (usuario = auth.uid() and public.elio_conv_abierta(conversacion));

-- La web no puede cambiar proyecto, rama ni fijado directamente (solo con las funciones de abajo)
create or replace function public.elio_proteger_conv() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and (new.proyecto is distinct from old.proyecto or new.rama_de is distinct from old.rama_de or new.fijado is distinct from old.fijado) then
    raise exception 'Usa las opciones del chat para moverlo o fijarlo.';
  end if;
  return new;
end $$;
drop trigger if exists elio_proteger_conv on public.conversaciones;
create trigger elio_proteger_conv before update on public.conversaciones for each row execute function public.elio_proteger_conv();

-- Máximo 10 chats por proyecto (también para ramas y chats nuevos desde elio-chat)
create or replace function public.elio_tope_proyecto() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.proyecto is not null and (tg_op = 'INSERT' or new.proyecto is distinct from old.proyecto) then
    perform pg_advisory_xact_lock(hashtext('elio_proy_' || new.proyecto::text));
    if (select count(*) from public.conversaciones where proyecto = new.proyecto and id <> new.id) >= 10 then
      raise exception 'Este proyecto ya tiene 10 chats, el máximo. Borra o saca alguno para agregar otro.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists elio_tope_proyecto on public.conversaciones;
create trigger elio_tope_proyecto before insert or update of proyecto on public.conversaciones for each row execute function public.elio_tope_proyecto();

-- ---------- Proyectos ----------
create or replace function public.elio_mis_proyectos() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('id', p.id, 'nombre', p.nombre, 'descripcion', p.descripcion,
    'con_clave', p.clave_hash is not null, 'abierto', public.elio_proyecto_abierto_de(auth.uid(), p.id),
    'abierto_hasta', (select hasta from public.proyecto_abierto a where a.proyecto = p.id and a.hasta > now()),
    'bloqueado_hasta', case when p.bloqueado_hasta > now() then p.bloqueado_hasta end,
    'chats', (select count(*) from public.conversaciones c where c.proyecto = p.id)) order by p.creado desc), '[]'::json)
  from public.proyectos p where p.usuario = auth.uid()
$$;
revoke all on function public.elio_mis_proyectos() from public, anon;
grant execute on function public.elio_mis_proyectos() to authenticated;

create or replace function public.elio_crear_proyecto(nombre text, descripcion text, clave text) returns uuid
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); nid uuid; n text := btrim(coalesce(nombre, ''));
begin
  if u is null then raise exception 'Inicia sesión.'; end if;
  if public.elio_plan(u) <> 'ultra' then raise exception 'Mis proyectos es parte del plan Ultra.'; end if;
  if length(n) < 1 or length(n) > 60 then raise exception 'El nombre debe tener de 1 a 60 letras.'; end if;
  if (select count(*) from public.proyectos where usuario = u) >= 20 then raise exception 'Llegaste a 20 proyectos, el máximo. Borra alguno para crear otro.'; end if;
  if clave is not null and clave <> '' and length(clave) < 8 then raise exception 'La contraseña del proyecto debe tener al menos 8 caracteres.'; end if;
  insert into public.proyectos (usuario, nombre, descripcion, clave_hash)
  values (u, n, nullif(left(btrim(coalesce(descripcion, '')), 300), ''),
          case when coalesce(clave, '') <> '' then extensions.crypt(clave, extensions.gen_salt('bf', 10)) end)
  returning id into nid;
  if coalesce(clave, '') <> '' then insert into public.proyecto_abierto values (nid, now() + interval '30 minutes'); end if;
  return nid;
end $$;
revoke all on function public.elio_crear_proyecto(text, text, text) from public, anon;
grant execute on function public.elio_crear_proyecto(text, text, text) to authenticated;

create or replace function public.elio_abrir_proyecto(p uuid, clave text) returns json
language plpgsql security definer set search_path = public as $$
declare x public.proyectos;
begin
  select * into x from public.proyectos where id = p and usuario = auth.uid() for update;
  if not found then raise exception 'Proyecto no encontrado.'; end if;
  if x.clave_hash is null then return json_build_object('ok', true); end if;
  if x.bloqueado_hasta > now() then
    return json_build_object('ok', false, 'motivo', 'bloqueado', 'hasta', x.bloqueado_hasta);
  end if;
  if extensions.crypt(coalesce(clave, ''), x.clave_hash) = x.clave_hash then
    update public.proyectos set intentos = 0, bloqueado_hasta = null where id = p;
    insert into public.proyecto_abierto values (p, now() + interval '30 minutes') on conflict (proyecto) do update set hasta = excluded.hasta;
    return json_build_object('ok', true, 'hasta', now() + interval '30 minutes');
  end if;
  update public.proyectos set intentos = case when intentos + 1 >= 5 then 0 else intentos + 1 end,
    bloqueado_hasta = case when intentos + 1 >= 5 then now() + interval '15 minutes' else bloqueado_hasta end
  where id = p;
  if x.intentos + 1 >= 5 then return json_build_object('ok', false, 'motivo', 'bloqueado', 'hasta', now() + interval '15 minutes'); end if;
  return json_build_object('ok', false, 'motivo', 'clave', 'quedan', 4 - x.intentos);
end $$;
revoke all on function public.elio_abrir_proyecto(uuid, text) from public, anon;
grant execute on function public.elio_abrir_proyecto(uuid, text) to authenticated;

create or replace function public.elio_cerrar_proyecto(p uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.proyecto_abierto a using public.proyectos x where a.proyecto = x.id and x.id = p and x.usuario = auth.uid()
$$;
revoke all on function public.elio_cerrar_proyecto(uuid) from public, anon;
grant execute on function public.elio_cerrar_proyecto(uuid) to authenticated;

-- Cambiar nombre, descripción o contraseña (el proyecto debe estar abierto). clave: null = no tocar, '' = quitarla.
create or replace function public.elio_editar_proyecto(p uuid, nombre text, descripcion text, clave text) returns void
language plpgsql security definer set search_path = public as $$
declare n text := btrim(coalesce(nombre, ''));
begin
  if not exists (select 1 from public.proyectos where id = p and usuario = auth.uid()) then raise exception 'Proyecto no encontrado.'; end if;
  if not public.elio_proyecto_abierto(p) then raise exception 'Abre el proyecto con su contraseña para cambiarlo.'; end if;
  if length(n) < 1 or length(n) > 60 then raise exception 'El nombre debe tener de 1 a 60 letras.'; end if;
  if clave is not null and clave <> '' and length(clave) < 8 then raise exception 'La contraseña del proyecto debe tener al menos 8 caracteres.'; end if;
  update public.proyectos set nombre = n, descripcion = nullif(left(btrim(coalesce(descripcion, '')), 300), ''),
    clave_hash = case when clave is null then clave_hash when clave = '' then null else extensions.crypt(clave, extensions.gen_salt('bf', 10)) end,
    intentos = 0, bloqueado_hasta = null
  where id = p;
end $$;
revoke all on function public.elio_editar_proyecto(uuid, text, text, text) from public, anon;
grant execute on function public.elio_editar_proyecto(uuid, text, text, text) to authenticated;

-- Borrar un proyecto: sus chats se borran o vuelven a la lista general
create or replace function public.elio_borrar_proyecto(p uuid, borrar_chats boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.proyectos where id = p and usuario = auth.uid()) then raise exception 'Proyecto no encontrado.'; end if;
  if not public.elio_proyecto_abierto(p) then raise exception 'Abre el proyecto con su contraseña para borrarlo.'; end if;
  if coalesce(borrar_chats, false) then delete from public.conversaciones where proyecto = p;
  else update public.conversaciones set proyecto = null where proyecto = p; end if;
  delete from public.proyectos where id = p;
end $$;
revoke all on function public.elio_borrar_proyecto(uuid, boolean) from public, anon;
grant execute on function public.elio_borrar_proyecto(uuid, boolean) to authenticated;

-- Olvidé la contraseña: código de 6 números al correo de la cuenta (vale 15 minutos, 5 intentos)
create or replace function public.elio_proyecto_olvide(p uuid) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); cod text := lpad((floor(random() * 1000000))::int::text, 6, '0'); correo text; nom text;
begin
  select nombre into nom from public.proyectos where id = p and usuario = u and clave_hash is not null;
  if nom is null then raise exception 'Proyecto no encontrado.'; end if;
  if exists (select 1 from public.proyectos where id = p and recuperar_vence > now() + interval '13 minutes') then
    raise exception 'Ya te enviamos un código hace poco. Revisa tu correo o espera 2 minutos.';
  end if;
  select email into correo from auth.users where id = u;
  update public.proyectos set recuperar_hash = encode(extensions.digest('elio-proy|' || p::text || '|' || cod, 'sha256'), 'hex'),
    recuperar_vence = now() + interval '15 minutes', recuperar_intentos = 0 where id = p;
  perform public.elio_correo(correo, 'Tu código para el proyecto de Elio',
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#102449;line-height:1.55"><p>Hola,</p><p>Tu código para cambiar la contraseña del proyecto <b>' || replace(replace(nom, '<', '&lt;'), '>', '&gt;') || '</b> es:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">' || cod || '</p><p style="font-size:12px;color:#5b6b85">Vale 15 minutos. Si no lo pediste, ignora este correo: tu proyecto sigue protegido. Nunca compartas este código.</p><p>Elio by FlexGo Group</p></div>',
    'Tu código para cambiar la contraseña del proyecto «' || nom || '» es: ' || cod || E'\nVale 15 minutos. Si no lo pediste, ignora este correo.\n\nElio by FlexGo Group', 'elio-proyecto-codigo');
end $$;
revoke all on function public.elio_proyecto_olvide(uuid) from public, anon;
grant execute on function public.elio_proyecto_olvide(uuid) to authenticated;

create or replace function public.elio_proyecto_recuperar(p uuid, codigo text, clave text) returns void
language plpgsql security definer set search_path = public as $$
declare x public.proyectos;
begin
  select * into x from public.proyectos where id = p and usuario = auth.uid() for update;
  if not found or x.recuperar_hash is null or x.recuperar_vence < now() then raise exception 'El código venció. Pide uno nuevo.'; end if;
  if x.recuperar_intentos >= 5 then raise exception 'Demasiados intentos. Pide un código nuevo.'; end if;
  if encode(extensions.digest('elio-proy|' || p::text || '|' || coalesce(codigo, ''), 'sha256'), 'hex') <> x.recuperar_hash then
    update public.proyectos set recuperar_intentos = recuperar_intentos + 1 where id = p;
    raise exception 'El código no es correcto.';
  end if;
  if coalesce(length(clave), 0) < 8 then raise exception 'La nueva contraseña debe tener al menos 8 caracteres.'; end if;
  update public.proyectos set clave_hash = extensions.crypt(clave, extensions.gen_salt('bf', 10)), intentos = 0, bloqueado_hasta = null,
    recuperar_hash = null, recuperar_vence = null, recuperar_intentos = 0 where id = p;
  insert into public.proyecto_abierto values (p, now() + interval '30 minutes') on conflict (proyecto) do update set hasta = excluded.hasta;
end $$;
revoke all on function public.elio_proyecto_recuperar(uuid, text, text) from public, anon;
grant execute on function public.elio_proyecto_recuperar(uuid, text, text) to authenticated;

-- Chats de un proyecto (solo si está abierto)
create or replace function public.elio_chats_proyecto(p uuid) returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.elio_proyecto_abierto(p) then raise exception 'CERRADO'; end if;
  return coalesce((select json_agg(json_build_object('id', id, 'titulo', titulo, 'actualizado', actualizado, 'fijado', fijado, 'rama_de', rama_de) order by actualizado desc)
    from public.conversaciones where proyecto = p and usuario = auth.uid()), '[]'::json);
end $$;
revoke all on function public.elio_chats_proyecto(uuid) from public, anon;
grant execute on function public.elio_chats_proyecto(uuid) to authenticated;

-- Mover un chat a un proyecto (o sacarlo con p = null)
create or replace function public.elio_mover_chat(c uuid, p uuid) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); actual uuid;
begin
  select proyecto into actual from public.conversaciones where id = c and usuario = u;
  if not found then raise exception 'Chat no encontrado.'; end if;
  if not public.elio_proyecto_abierto(actual) then raise exception 'Abre primero el proyecto donde está el chat.'; end if;
  if p is not null then
    if public.elio_plan(u) <> 'ultra' then raise exception 'Mis proyectos es parte del plan Ultra.'; end if;
    if not exists (select 1 from public.proyectos where id = p and usuario = u) then raise exception 'Proyecto no encontrado.'; end if;
    if not public.elio_proyecto_abierto(p) then raise exception 'Abre ese proyecto con su contraseña para mover chats a él.'; end if;
  end if;
  update public.conversaciones set proyecto = p where id = c;
end $$;
revoke all on function public.elio_mover_chat(uuid, uuid) from public, anon;
grant execute on function public.elio_mover_chat(uuid, uuid) to authenticated;

-- ---------- Ramas (Ultra): copia el chat hasta un mensaje ----------
create or replace function public.elio_ramificar(c uuid, hasta bigint) returns uuid
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); o public.conversaciones; nid uuid; n int;
begin
  if public.elio_plan(u) <> 'ultra' then raise exception 'Las ramas son parte del plan Ultra.'; end if;
  select * into o from public.conversaciones where id = c and usuario = u;
  if not found then raise exception 'Chat no encontrado.'; end if;
  if not public.elio_proyecto_abierto(o.proyecto) then raise exception 'Abre primero el proyecto de este chat.'; end if;
  perform pg_advisory_xact_lock(hashtext('elio_rama_' || c::text));
  select count(*) into n from public.conversaciones where rama_de = c;
  if n >= 5 then raise exception 'Este chat ya tiene 5 ramas, el máximo.'; end if;
  if not exists (select 1 from public.mensajes where conversacion = c and id = hasta) then raise exception 'Mensaje no encontrado.'; end if;
  insert into public.conversaciones (usuario, titulo, proyecto, rama_de, documentos)
  values (u, left('Rama ' || (n + 1) || ' · ' || o.titulo, 80), o.proyecto, c, o.documentos)
  returning id into nid;
  insert into public.mensajes (conversacion, usuario, rol, contenido, nivel, adjunto, creado)
  select nid, u, rol, contenido, nivel, adjunto, creado from (
    select * from public.mensajes where conversacion = c and id <= hasta order by id desc limit 200) m
  order by m.id;
  return nid;
end $$;
revoke all on function public.elio_ramificar(uuid, bigint) from public, anon;
grant execute on function public.elio_ramificar(uuid, bigint) to authenticated;

-- ---------- Fijar chats (todos los planes, máximo 3) ----------
create or replace function public.elio_fijar_chat(c uuid, fijar boolean) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if not exists (select 1 from public.conversaciones where id = c and usuario = u and public.elio_proyecto_abierto(proyecto)) then raise exception 'Chat no encontrado.'; end if;
  if fijar and (select count(*) from public.conversaciones where usuario = u and fijado and id <> c) >= 3 then
    raise exception 'Puedes fijar hasta 3 chats. Quita uno para fijar otro.';
  end if;
  update public.conversaciones set fijado = coalesce(fijar, false) where id = c;
end $$;
revoke all on function public.elio_fijar_chat(uuid, boolean) from public, anon;
grant execute on function public.elio_fijar_chat(uuid, boolean) to authenticated;

-- Comprobación: 6 filas en «true»
select 'proyectos_rls' as que, (select rowsecurity from pg_tables where schemaname='public' and tablename='proyectos') as ok
union all select 'abierto_rls', (select rowsecurity from pg_tables where schemaname='public' and tablename='proyecto_abierto')
union all select 'conv_cerrada', (select qual from pg_policies where tablename='conversaciones' and policyname='conv propias ver') like '%elio_proyecto_abierto%'
union all select 'mensajes_cerrados', (select qual from pg_policies where tablename='mensajes' and policyname='mensajes propios ver') like '%elio_conv_abierta%'
union all select 'tope_10', exists(select 1 from pg_trigger where tgname = 'elio_tope_proyecto' and not tgisinternal)
union all select 'bcrypt', extensions.crypt('x', extensions.gen_salt('bf', 4)) like '$2a$%';

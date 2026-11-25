-- ELIO by FlexGo Group · Esquema de la base de datos (versión 1, 25-nov-2026)
-- Se ejecuta UNA vez en el proyecto «elio»: SQL Editor › pegar todo › Run.
-- Se puede ejecutar de nuevo sin dañar nada (usa IF NOT EXISTS / CREATE OR REPLACE).

-- ---------- Tablas ----------
create table if not exists public.perfiles (
  id uuid primary key references auth.users on delete cascade,
  nombre text,
  plan text not null default 'libre' check (plan in ('libre','impulso','ultra')),
  plan_vence date,
  es_admin boolean not null default false,
  acepto_terminos timestamptz,
  creado timestamptz not null default now()
);

create table if not exists public.conversaciones (
  id uuid primary key default gen_random_uuid(),
  usuario uuid not null references auth.users on delete cascade,
  titulo text not null default 'Nuevo chat',
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
create index if not exists conversaciones_usuario on public.conversaciones (usuario, actualizado desc);

create table if not exists public.mensajes (
  id bigserial primary key,
  conversacion uuid not null references public.conversaciones on delete cascade,
  usuario uuid not null references auth.users on delete cascade,
  rol text not null check (rol in ('user','assistant')),
  contenido text not null,
  nivel text check (nivel in ('rapido','razonamiento','experto')),
  adjunto text,
  creado timestamptz not null default now()
);
create index if not exists mensajes_conv on public.mensajes (conversacion, id);

-- Uso por día (hora de Lima). Los cupos mensuales se suman desde aquí.
create table if not exists public.uso (
  usuario uuid not null references auth.users on delete cascade,
  dia date not null,
  rapido int not null default 0,
  razonamiento int not null default 0,
  experto int not null default 0,
  costo_usd numeric(12,6) not null default 0,
  primary key (usuario, dia)
);

-- Gasto total del día, para los topes de seguridad.
create table if not exists public.gasto_dia (
  dia date primary key,
  libre_usd numeric(12,6) not null default 0,
  total_usd numeric(12,6) not null default 0
);

-- Pagos por Yape: el usuario avisa, el administrador aprueba.
create table if not exists public.pagos (
  id bigserial primary key,
  usuario uuid not null references auth.users on delete cascade,
  plan text not null check (plan in ('impulso','ultra')),
  meses int not null default 1 check (meses between 1 and 12),
  monto numeric(10,2) not null,
  operacion text not null check (length(operacion) between 4 and 30),
  estado text not null default 'pendiente' check (estado in ('pendiente','aprobado','rechazado')),
  nota text,
  creado timestamptz not null default now(),
  revisado timestamptz
);

-- ---------- Seguridad por fila ----------
alter table public.perfiles enable row level security;
alter table public.conversaciones enable row level security;
alter table public.mensajes enable row level security;
alter table public.uso enable row level security;
alter table public.gasto_dia enable row level security;
alter table public.pagos enable row level security;

drop policy if exists "perfil propio" on public.perfiles;
create policy "perfil propio" on public.perfiles for select using (id = auth.uid());

drop policy if exists "conv propias ver" on public.conversaciones;
create policy "conv propias ver" on public.conversaciones for select using (usuario = auth.uid());
drop policy if exists "conv propias editar" on public.conversaciones;
create policy "conv propias editar" on public.conversaciones for update using (usuario = auth.uid()) with check (usuario = auth.uid());
drop policy if exists "conv propias borrar" on public.conversaciones;
create policy "conv propias borrar" on public.conversaciones for delete using (usuario = auth.uid());

drop policy if exists "mensajes propios ver" on public.mensajes;
create policy "mensajes propios ver" on public.mensajes for select using (usuario = auth.uid());

drop policy if exists "uso propio" on public.uso;
create policy "uso propio" on public.uso for select using (usuario = auth.uid());

drop policy if exists "pagos propios ver" on public.pagos;
create policy "pagos propios ver" on public.pagos for select using (usuario = auth.uid());
drop policy if exists "pagos propios avisar" on public.pagos;
create policy "pagos propios avisar" on public.pagos for insert
  with check (usuario = auth.uid() and estado = 'pendiente' and revisado is null and nota is null);
-- gasto_dia: sin políticas = nadie lo lee desde la web (solo la función del servidor).

-- ---------- Perfil automático al registrarse ----------
create or replace function public.elio_nuevo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles (id, nombre)
  values (new.id, left(coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)), 40))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists elio_nuevo_usuario on auth.users;
create trigger elio_nuevo_usuario after insert on auth.users
  for each row execute function public.elio_nuevo_usuario();

-- ---------- Funciones para el usuario ----------
create or replace function public.elio_hoy() returns date
language sql stable as $$ select (now() at time zone 'America/Lima')::date $$;

-- Plan vigente (si venció, vuelve a Libre)
create or replace function public.elio_plan(u uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when p.plan <> 'libre' and (p.plan_vence is null or p.plan_vence < public.elio_hoy()) then 'libre' else p.plan end
  from public.perfiles p where p.id = u
$$;

-- Lo que el usuario ve en su panel: plan, vencimiento y cupos usados
create or replace function public.elio_mi_estado() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'nombre', p.nombre, 'plan', public.elio_plan(p.id), 'plan_vence', p.plan_vence, 'es_admin', p.es_admin,
    'acepto', p.acepto_terminos is not null,
    'hoy', coalesce((select json_build_object('rapido', u.rapido, 'razonamiento', u.razonamiento, 'experto', u.experto)
                     from public.uso u where u.usuario = p.id and u.dia = public.elio_hoy()), '{"rapido":0,"razonamiento":0,"experto":0}'::json),
    'mes', (select json_build_object('rapido', coalesce(sum(u.rapido),0), 'razonamiento', coalesce(sum(u.razonamiento),0), 'experto', coalesce(sum(u.experto),0))
            from public.uso u where u.usuario = p.id and u.dia >= date_trunc('month', public.elio_hoy())::date),
    'pago_pendiente', exists(select 1 from public.pagos g where g.usuario = p.id and g.estado = 'pendiente')
  )
  from public.perfiles p where p.id = auth.uid()
$$;

create or replace function public.elio_guardar_nombre(n text) returns void
language sql security definer set search_path = public as $$
  update public.perfiles set nombre = left(trim(n), 40) where id = auth.uid() and length(trim(n)) between 2 and 40
$$;

create or replace function public.elio_aceptar_terminos() returns void
language sql security definer set search_path = public as $$
  update public.perfiles set acepto_terminos = now() where id = auth.uid() and acepto_terminos is null
$$;

-- ---------- Funciones del servidor (solo la función elio-chat, con la clave de servicio) ----------
create or replace function public.elio_sumar_uso(u uuid, nivel text, costo numeric, es_libre boolean) returns void
language plpgsql security definer set search_path = public as $$
declare d date := public.elio_hoy();
begin
  insert into public.uso (usuario, dia) values (u, d) on conflict do nothing;
  update public.uso set
    rapido = rapido + (nivel = 'rapido')::int,
    razonamiento = razonamiento + (nivel = 'razonamiento')::int,
    experto = experto + (nivel = 'experto')::int,
    costo_usd = costo_usd + costo
  where usuario = u and dia = d;
  insert into public.gasto_dia (dia) values (d) on conflict do nothing;
  update public.gasto_dia set total_usd = total_usd + costo, libre_usd = libre_usd + case when es_libre then costo else 0 end where dia = d;
end $$;
revoke all on function public.elio_sumar_uso(uuid, text, numeric, boolean) from public, anon, authenticated;

-- ---------- Administración (solo perfiles con es_admin = true) ----------
create or replace function public.elio_es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select es_admin from public.perfiles where id = auth.uid()), false)
$$;

create or replace function public.elio_admin_resumen() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.elio_es_admin() then raise exception 'Solo administradores'; end if;
  return json_build_object(
    'usuarios', (select count(*) from public.perfiles),
    'por_plan', (select json_object_agg(pl, n) from (select public.elio_plan(id) pl, count(*) n from public.perfiles group by 1) x),
    'gasto_hoy', (select row_to_json(g) from public.gasto_dia g where g.dia = public.elio_hoy()),
    'gasto_mes', (select coalesce(sum(total_usd),0) from public.gasto_dia where dia >= date_trunc('month', public.elio_hoy())::date),
    'mensajes_hoy', (select coalesce(sum(rapido + razonamiento + experto),0) from public.uso where dia = public.elio_hoy()),
    'pagos', (select coalesce(json_agg(x order by x.creado desc), '[]'::json) from (
       select g.id, g.plan, g.meses, g.monto, g.operacion, g.estado, g.creado, p.nombre, au.email
       from public.pagos g join public.perfiles p on p.id = g.usuario join auth.users au on au.id = g.usuario
       order by g.creado desc limit 50) x)
  );
end $$;

create or replace function public.elio_admin_pago(pago bigint, aprobar boolean, motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
declare g public.pagos;
begin
  if not public.elio_es_admin() then raise exception 'Solo administradores'; end if;
  select * into g from public.pagos where id = pago and estado = 'pendiente' for update;
  if not found then raise exception 'Ese pago ya fue revisado o no existe'; end if;
  update public.pagos set estado = case when aprobar then 'aprobado' else 'rechazado' end, revisado = now(), nota = motivo where id = pago;
  if aprobar then
    update public.perfiles set
      plan = g.plan,
      plan_vence = greatest(coalesce(case when plan = g.plan then plan_vence end, public.elio_hoy()), public.elio_hoy()) + (30 * g.meses)
    where id = g.usuario;
  end if;
end $$;

-- Comprobación: debe devolver 6 filas con «true»
select 'tablas' as que, count(*) = 6 as ok from information_schema.tables where table_schema = 'public' and table_name in ('perfiles','conversaciones','mensajes','uso','gasto_dia','pagos')
union all select 'rls', bool_and(rowsecurity) from pg_tables where schemaname = 'public' and tablename in ('perfiles','conversaciones','mensajes','uso','gasto_dia','pagos')
union all select 'trigger', exists(select 1 from pg_trigger where tgname = 'elio_nuevo_usuario')
union all select 'sumar_uso cerrado', not has_function_privilege('authenticated', 'public.elio_sumar_uso(uuid,text,numeric,boolean)', 'execute')
union all select 'estado', exists(select 1 from pg_proc where proname = 'elio_mi_estado')
union all select 'admin', exists(select 1 from pg_proc where proname = 'elio_admin_pago');

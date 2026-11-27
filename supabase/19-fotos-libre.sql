-- ELIO · Versión 19 (27-nov-2026): 3 fotos por semana en el plan Libre (decisión del usuario).
--  - Solo fotos (sin PDF). Se achican en el navegador (1600 px, JPG, máx. 2 MB).
--  - Cupo por persona: 3 por semana (lunes a domingo, hora de Perú).
--  - Tope GLOBAL diario para todas las fotos de Libre (contra cuentas múltiples): lo decide la función con TOPE_FOTOS_LIBRE_USD.
--  - Además, cada foto gasta créditos de Libre y suma al tope diario de Libre que ya existe.
-- Se ejecuta en el SQL Editor del proyecto «elio». Se puede repetir sin daño.

alter table public.gasto_dia add column if not exists fotos_libre_usd numeric(12,6) not null default 0;

create table if not exists public.fotos_libre (
  id bigserial primary key,
  usuario uuid not null references auth.users on delete cascade,
  costo numeric(12,6) not null default 0,
  creado timestamptz not null default now()
);
create index if not exists fotos_libre_usuario on public.fotos_libre (usuario, creado desc);
alter table public.fotos_libre enable row level security;   -- sin políticas: solo el servidor

-- Reserva una foto ANTES de llamar a la IA (atómico). Devuelve el id, o un error 'SEMANA' o 'GLOBAL'.
create or replace function public.elio_reservar_foto_libre(u uuid, tope numeric, cupo int default 3) returns bigint
language plpgsql security definer set search_path = public as $$
declare n int; g numeric; nuevo bigint;
begin
  perform pg_advisory_xact_lock(hashtext('foto_libre:' || u::text));
  select count(*) into n from public.fotos_libre where usuario = u and creado >= public.elio_inicio_semana();
  if n >= cupo then raise exception 'SEMANA'; end if;
  select coalesce(fotos_libre_usd, 0) into g from public.gasto_dia where dia = (now() at time zone 'America/Lima')::date;
  if coalesce(g, 0) >= tope then raise exception 'GLOBAL'; end if;
  insert into public.fotos_libre (usuario) values (u) returning id into nuevo;
  return nuevo;
end $$;
revoke all on function public.elio_reservar_foto_libre(uuid, numeric, int) from public, anon, authenticated;

-- Cobra el costo real de la foto (o la devuelve si no hubo respuesta: costo < 0)
create or replace function public.elio_cobrar_foto_libre(f bigint, costo numeric) returns void
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'America/Lima')::date;
begin
  if costo < 0 then delete from public.fotos_libre where id = f; return; end if;
  update public.fotos_libre set costo = elio_cobrar_foto_libre.costo where id = f;
  insert into public.gasto_dia (dia) values (d) on conflict do nothing;
  update public.gasto_dia set fotos_libre_usd = fotos_libre_usd + elio_cobrar_foto_libre.costo where dia = d;
end $$;
revoke all on function public.elio_cobrar_foto_libre(bigint, numeric) from public, anon, authenticated;

-- Para la web: cuántas fotos gratis le quedan esta semana
create or replace function public.elio_mis_fotos_libre() returns int
language sql stable security definer set search_path = public as $$
  select greatest(0, 3 - (select count(*)::int from public.fotos_libre where usuario = auth.uid() and creado >= public.elio_inicio_semana()))
$$;
revoke all on function public.elio_mis_fotos_libre() from public, anon;
grant execute on function public.elio_mis_fotos_libre() to authenticated;

-- Comprobación: 3 filas en «true»
select 'fotos_rls' as que, (select rowsecurity from pg_tables where schemaname='public' and tablename='fotos_libre') as ok
union all select 'gasto_fotos', exists (select 1 from information_schema.columns where table_schema='public' and table_name='gasto_dia' and column_name='fotos_libre_usd')
union all select 'anon_sin_reserva', not has_function_privilege('anon', 'public.elio_reservar_foto_libre(uuid, numeric, integer)', 'execute');

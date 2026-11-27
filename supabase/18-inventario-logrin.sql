-- ELIO · Versión 18 (26-nov-2026): R-175 · Inventario de Logrin desde una foto (lado de Elio).
--  - Enlace de la cuenta de Elio con UN negocio de Logrin, usando un código de un solo uso que genera el dueño en Logrin.
--  - Elio lee la foto y arma una lista. La persona la revisa y la corrige, y solo con «Enviar a Logrin» se manda.
--    En Logrin queda «Por confirmar» hasta que el dueño la acepta. Elio nunca escribe stock ni ve precios.
--  - Toda la comunicación con Logrin pasa por la función elio-logrin (HMAC). La web solo lee.
-- Se ejecuta en el SQL Editor del proyecto «elio». Se puede repetir sin daño.

create table if not exists public.logrin_enlaces (
  usuario uuid primary key references auth.users on delete cascade,
  enlace_id text not null check (length(enlace_id) between 8 and 80),
  negocio_nombre text not null check (length(negocio_nombre) <= 120),
  creado timestamptz not null default now()
);
alter table public.logrin_enlaces enable row level security;
drop policy if exists "enlace propio" on public.logrin_enlaces;
create policy "enlace propio" on public.logrin_enlaces for select using (usuario = auth.uid());

create table if not exists public.inventario_propuestas (
  id uuid primary key default gen_random_uuid(),
  usuario uuid not null references auth.users on delete cascade,
  items jsonb not null default '[]'::jsonb,
  estado text not null default 'borrador' check (estado in ('borrador','enviada','error')),
  respuesta jsonb,
  creado timestamptz not null default now(),
  enviada timestamptz
);
create index if not exists inv_prop_usuario on public.inventario_propuestas (usuario, creado desc);
alter table public.inventario_propuestas enable row level security;
drop policy if exists "propuestas propias" on public.inventario_propuestas;
create policy "propuestas propias" on public.inventario_propuestas for select using (usuario = auth.uid());

alter table public.consumo drop constraint if exists consumo_funcion_check;
alter table public.consumo add constraint consumo_funcion_check check (funcion in ('chat','invitado','biblioteca','busqueda','imagen','probadita','inventario'));

-- ===== «Elio para Logrin»: el plan llega desde Logrin (26-nov) =====
-- Logrin manda {accion:"plan", enlace_id, activo, plan:"ultra", vence} firmado. Elio lo guarda aparte y usa el plan MÁS ALTO.
-- Si llega activo:false o pasa la fecha «vence», la cuenta vuelve sola a su plan propio.
alter table public.logrin_enlaces add column if not exists plan_logrin text check (plan_logrin in ('ultra'));
alter table public.logrin_enlaces add column if not exists plan_vence timestamptz;
create unique index if not exists logrin_enlaces_enlace on public.logrin_enlaces (enlace_id);

-- Peticiones ya recibidas (no se aplica dos veces la misma). Solo el servidor la usa.
create table if not exists public.logrin_peticiones (
  id uuid primary key,
  recibido timestamptz not null default now()
);
alter table public.logrin_peticiones enable row level security;

create or replace function public.elio_plan_logrin(u uuid) returns text
language sql stable security definer set search_path = public as $$
  select e.plan_logrin from public.logrin_enlaces e
  where e.usuario = u and e.plan_logrin is not null and e.plan_vence > now()
$$;
revoke all on function public.elio_plan_logrin(uuid) from public, anon, authenticated;

-- Plan efectivo: el más alto entre el propio, el de Logrin y el Ultra compartido
create or replace function public.elio_plan(u uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when public.elio_plan_propio(u) = 'ultra' then 'ultra'
    when public.elio_plan_logrin(u) = 'ultra' then 'ultra'
    when public.elio_plan_propio(u) <> 'libre' then public.elio_plan_propio(u)
    when exists (select 1 from public.ultra_compartido c where c.invitado = u and c.estado = 'activa' and public.elio_plan_propio(c.titular) = 'ultra') then 'ultra'
    else 'libre' end
$$;
revoke all on function public.elio_plan(uuid) from public, anon, authenticated;

-- Ultra de Logrin = Ultra para 2 personas del negocio: la mitad de créditos para cada una (75 cada 5 h y 390 por semana)
create or replace function public.elio_comparte(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.ultra_compartido c where c.estado = 'activa' and c.invitado is not null and (c.titular = u or c.invitado = u))
      or (public.elio_plan_propio(u) <> 'ultra' and public.elio_plan_logrin(u) = 'ultra')
$$;
revoke all on function public.elio_comparte(uuid) from public, anon, authenticated;

-- Comprobación: 5 filas en «true»
select 'enlaces_rls' as que, (select rowsecurity from pg_tables where schemaname='public' and tablename='logrin_enlaces') as ok
union all select 'propuestas_rls', (select rowsecurity from pg_tables where schemaname='public' and tablename='inventario_propuestas')
union all select 'consumo_inventario', pg_get_constraintdef((select oid from pg_constraint where conname='consumo_funcion_check')) like '%inventario%'
union all select 'plan_logrin', exists (select 1 from information_schema.columns where table_schema='public' and table_name='logrin_enlaces' and column_name='plan_vence')
union all select 'peticiones_rls', (select rowsecurity from pg_tables where schemaname='public' and tablename='logrin_peticiones');

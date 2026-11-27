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

-- Comprobación: 3 filas en «true»
select 'enlaces_rls' as que, (select rowsecurity from pg_tables where schemaname='public' and tablename='logrin_enlaces') as ok
union all select 'propuestas_rls', (select rowsecurity from pg_tables where schemaname='public' and tablename='inventario_propuestas')
union all select 'consumo_inventario', pg_get_constraintdef((select oid from pg_constraint where conname='consumo_funcion_check')) like '%inventario%';

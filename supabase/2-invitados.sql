-- ELIO · Versión 2 (25-nov-2026): preguntas sin cuenta (invitados) y gasto sin usuario.
-- Se ejecuta una vez en el SQL Editor del proyecto «elio». Se puede repetir sin daño.

create table if not exists public.invitados (
  huella text not null,          -- huella anónima del día (no se guarda la IP)
  dia date not null,
  n int not null default 0,
  primary key (huella, dia)
);
alter table public.invitados enable row level security;   -- sin políticas: nadie lo lee desde la web

-- Suma una pregunta de invitado y devuelve cuántas lleva hoy (solo la función del servidor)
create or replace function public.elio_invitado_sumar(h text) returns int
language plpgsql security definer set search_path = public as $$
declare d date := public.elio_hoy(); v int;
begin
  insert into public.invitados (huella, dia, n) values (h, d, 1)
  on conflict (huella, dia) do update set n = public.invitados.n + 1
  returning n into v;
  return v;
end $$;
revoke all on function public.elio_invitado_sumar(text) from public, anon, authenticated;

create or replace function public.elio_invitado_cuantas(h text) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select n from public.invitados where huella = h and dia = public.elio_hoy()), 0)
$$;
revoke all on function public.elio_invitado_cuantas(text) from public, anon, authenticated;

-- Gasto sin usuario (invitados)
create or replace function public.elio_sumar_gasto(costo numeric, es_libre boolean) returns void
language plpgsql security definer set search_path = public as $$
declare d date := public.elio_hoy();
begin
  insert into public.gasto_dia (dia) values (d) on conflict do nothing;
  update public.gasto_dia set total_usd = total_usd + costo, libre_usd = libre_usd + case when es_libre then costo else 0 end where dia = d;
end $$;
revoke all on function public.elio_sumar_gasto(numeric, boolean) from public, anon, authenticated;

-- Las funciones internas tampoco deben poder llamarse desde la web
revoke all on function public.elio_plan(uuid) from public, anon, authenticated;

-- Comprobación: 3 filas en «true»
select 'invitados' as que, exists(select 1 from information_schema.tables where table_schema='public' and table_name='invitados') as ok
union all select 'cerrado', not has_function_privilege('anon', 'public.elio_invitado_sumar(text)', 'execute')
union all select 'gasto', exists(select 1 from pg_proc where proname = 'elio_sumar_gasto');

-- ELIO · Versión 11 (26-nov-2026): Trabajos académicos (mis referencias en APA 7, Vancouver e ISO 690).
--  - Cada persona guarda sus fuentes reales (con sus datos o buscadas por DOI en Crossref). Elio nunca inventa referencias.
--  - El formato (APA, Vancouver, ISO 690) se arma en la web, sin IA: costo cero.
--  - Cupo de referencias guardadas: Libre 20 · Impulso 300 · Ultra 1000.
-- Se ejecuta en el SQL Editor del proyecto «elio». Se puede repetir sin daño.

create table if not exists public.referencias (
  id bigserial primary key,
  usuario uuid not null default auth.uid() references auth.users on delete cascade,
  tipo text not null check (tipo in ('articulo','libro','capitulo','web','tesis')),
  datos jsonb not null check (octet_length(datos::text) <= 6000),
  proyecto text check (length(proyecto) <= 80),
  creado timestamptz not null default now()
);
create index if not exists referencias_usuario on public.referencias (usuario, creado desc);
alter table public.referencias enable row level security;
drop policy if exists "referencias propias ver" on public.referencias;
create policy "referencias propias ver" on public.referencias for select using (usuario = auth.uid());
drop policy if exists "referencias propias crear" on public.referencias;
create policy "referencias propias crear" on public.referencias for insert with check (usuario = auth.uid());
drop policy if exists "referencias propias editar" on public.referencias;
create policy "referencias propias editar" on public.referencias for update using (usuario = auth.uid()) with check (usuario = auth.uid());
drop policy if exists "referencias propias borrar" on public.referencias;
create policy "referencias propias borrar" on public.referencias for delete using (usuario = auth.uid());

create or replace function public.elio_cupo_referencias() returns trigger
language plpgsql security definer set search_path = public as $$
declare tope int := (case public.elio_plan(new.usuario) when 'ultra' then 1000 when 'impulso' then 300 else 20 end);
begin
  if (select count(*) from public.referencias where usuario = new.usuario) >= tope then
    raise exception 'Llegaste a % referencias guardadas, el máximo de tu plan. Borra alguna o sube de plan.', tope;
  end if;
  return new;
end $$;
revoke all on function public.elio_cupo_referencias() from public, anon, authenticated;
drop trigger if exists elio_cupo_referencias on public.referencias;
create trigger elio_cupo_referencias before insert on public.referencias for each row execute function public.elio_cupo_referencias();

-- Comprobación: 2 filas en «true»
select 'tabla_rls' as que, (select rowsecurity from pg_tables where schemaname='public' and tablename='referencias') as ok
union all select 'cupo', exists(select 1 from pg_trigger where tgname = 'elio_cupo_referencias' and not tgisinternal);

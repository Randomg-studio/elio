-- ELIO · Versión 7 (25-nov-2026): Biblioteca de vida (lo que aprendo de libros, artículos, videos y cursos).
--  - Cada persona guarda lo que aprendió: título, enlace (opcional) y sus notas o el texto que pegue.
--  - Elio arma un resumen, 3 a 5 ideas clave y etiquetas. Elio NO abre enlaces de terceros (solo usa lo que la persona pega).
--  - «¿Qué aprendí sobre X?» busca aquí y en sus documentos, y cita el título.
--  - Cupo: Libre 20 · Impulso 300 · Ultra 1000. No alimenta el perfil de intereses.
-- Se ejecuta en el SQL Editor del proyecto «elio». Se puede repetir sin daño.

create table if not exists public.aprendizajes (
  id bigserial primary key,
  usuario uuid not null references auth.users on delete cascade,
  tipo text not null default 'otro' check (tipo in ('libro','articulo','video','curso','podcast','otro')),
  titulo text not null check (length(titulo) between 1 and 160),
  enlace text check (enlace is null or (length(enlace) <= 500 and enlace ~* '^https?://')),
  nota text check (length(nota) <= 30000),
  resumen text,
  ideas text[] not null default '{}',
  etiquetas text[] not null default '{}',
  tsv tsvector generated always as (to_tsvector('spanish',
        coalesce(titulo,'') || ' ' || coalesce(resumen,'') || ' ' || coalesce(nota,''))) stored,
  creado timestamptz not null default now()
);
create index if not exists aprendizajes_usuario on public.aprendizajes (usuario, creado desc);
create index if not exists aprendizajes_tsv on public.aprendizajes using gin (tsv);

alter table public.aprendizajes enable row level security;
drop policy if exists "aprendizajes propios ver" on public.aprendizajes;
create policy "aprendizajes propios ver" on public.aprendizajes for select using (usuario = auth.uid());
drop policy if exists "aprendizajes propios borrar" on public.aprendizajes;
create policy "aprendizajes propios borrar" on public.aprendizajes for delete using (usuario = auth.uid());
-- Crear: solo desde la función del servidor (arma el resumen).

create or replace function public.elio_cupo_aprendizajes() returns trigger
language plpgsql security definer set search_path = public as $$
declare tope int := case public.elio_plan(new.usuario) when 'ultra' then 1000 when 'impulso' then 300 else 20 end;
begin
  if (select count(*) from public.aprendizajes where usuario = new.usuario) >= tope then
    raise exception 'Llegaste a % aprendizajes guardados, el máximo de tu plan. Borra alguno o sube de plan.', tope;
  end if;
  return new;
end $$;
revoke all on function public.elio_cupo_aprendizajes() from public, anon, authenticated;
drop trigger if exists elio_cupo_aprendizajes on public.aprendizajes;
create trigger elio_cupo_aprendizajes before insert on public.aprendizajes for each row execute function public.elio_cupo_aprendizajes();

-- Búsqueda en lo aprendido de UNA persona (solo la función del servidor)
create or replace function public.elio_buscar_aprendizajes(u uuid, q text, lim int default 5)
returns table (id bigint, tipo text, titulo text, resumen text, ideas text[], nota text, rango real)
language sql stable security definer set search_path = public as $$
  with consulta as (
    select websearch_to_tsquery('spanish', q) as estricta,
           to_tsquery('spanish', coalesce(nullif(array_to_string(array(
             select lexeme from unnest(to_tsvector('spanish', q))), ' | '), ''), 'xyzxyz')) as amplia
  )
  select a.id, a.tipo, a.titulo, a.resumen, a.ideas, left(a.nota, 1500),
         greatest(ts_rank(a.tsv, c.estricta) * 2, ts_rank(a.tsv, c.amplia)) as rango
  from public.aprendizajes a, consulta c
  where a.usuario = u and (a.tsv @@ c.estricta or a.tsv @@ c.amplia)
  order by rango desc
  limit greatest(1, least(lim, 8))
$$;
revoke all on function public.elio_buscar_aprendizajes(uuid, text, int) from public, anon, authenticated;

-- Comprobación: 3 filas en «true»
select 'tabla_rls' as que, (select rowsecurity from pg_tables where schemaname='public' and tablename='aprendizajes') as ok
union all select 'cupo', exists(select 1 from pg_trigger where tgname = 'elio_cupo_aprendizajes' and not tgisinternal)
union all select 'busqueda_cerrada', not has_function_privilege('authenticated', 'public.elio_buscar_aprendizajes(uuid, text, int)', 'execute');

-- ELIO · Versión 9 (26-nov-2026): «Trae tu historial», fase 1 (prompt rápido + «Lo que Elio aprendió de ti»).
--  - La persona pega lo que otra IA (ChatGPT, Claude, Gemini…) sabe de ella. Elio arma un borrador corto.
--  - Elio usa en el chat SOLO las memorias que la persona revisó y aprobó.
--  - Cupo de memorias creadas: Libre 1 en total · Impulso 3 al mes · Ultra 10 al mes.
--  - No alimenta el perfil de intereses ni las ofertas. Se puede editar o borrar cuando quiera.
-- Se ejecuta en el SQL Editor del proyecto «elio». Se puede repetir sin daño.

create table if not exists public.memorias (
  id bigserial primary key,
  usuario uuid not null references auth.users on delete cascade,
  origen text not null default 'otro' check (origen in ('chatgpt','claude','gemini','otro')),
  resumen text not null check (length(resumen) between 1 and 3000),
  estado text not null default 'borrador' check (estado in ('borrador','aprobada')),
  ocultos int not null default 0,          -- cuántos datos sensibles se taparon
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
create index if not exists memorias_usuario on public.memorias (usuario, estado);

alter table public.memorias enable row level security;
drop policy if exists "memorias propias ver" on public.memorias;
create policy "memorias propias ver" on public.memorias for select using (usuario = auth.uid());
drop policy if exists "memorias propias borrar" on public.memorias;
create policy "memorias propias borrar" on public.memorias for delete using (usuario = auth.uid());
-- Crear: solo la función del servidor. Editar y aprobar: con elio_memoria_aprobar.

create or replace function public.elio_cupo_memorias() returns trigger
language plpgsql security definer set search_path = public as $$
declare p text := public.elio_plan(new.usuario); n int;
begin
  if p = 'libre' then
    select count(*) into n from public.memorias where usuario = new.usuario;
    if n >= 1 then raise exception 'En el plan Libre puedes traer 1 memoria. Borra la anterior o pásate a Impulso.'; end if;
  else
    select count(*) into n from public.memorias where usuario = new.usuario and creado >= date_trunc('month', now());
    if n >= (case p when 'ultra' then 10 else 3 end) then
      raise exception 'Llegaste a % memorias este mes, el máximo de tu plan.', (case p when 'ultra' then 10 else 3 end);
    end if;
  end if;
  return new;
end $$;
revoke all on function public.elio_cupo_memorias() from public, anon, authenticated;
drop trigger if exists elio_cupo_memorias on public.memorias;
create trigger elio_cupo_memorias before insert on public.memorias for each row execute function public.elio_cupo_memorias();

-- Editar el texto y aprobarlo (o volverlo a borrador)
create or replace function public.elio_memoria_aprobar(m bigint, texto text, aprobar boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if length(trim(coalesce(texto, ''))) < 3 or length(texto) > 3000 then raise exception 'El texto debe tener entre 3 y 3.000 caracteres.'; end if;
  update public.memorias set resumen = trim(texto), estado = case when aprobar then 'aprobada' else 'borrador' end, actualizado = now()
  where id = m and usuario = auth.uid();
  if not found then raise exception 'Esa memoria no existe.'; end if;
end $$;
revoke all on function public.elio_memoria_aprobar(bigint, text, boolean) from public, anon;
grant execute on function public.elio_memoria_aprobar(bigint, text, boolean) to authenticated;

-- Comprobación: 3 filas en «true»
select 'tabla_rls' as que, (select rowsecurity from pg_tables where schemaname='public' and tablename='memorias') as ok
union all select 'cupo', exists(select 1 from pg_trigger where tgname = 'elio_cupo_memorias' and not tgisinternal)
union all select 'aprobar', exists(select 1 from pg_proc where proname = 'elio_memoria_aprobar');

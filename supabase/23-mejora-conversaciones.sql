-- ELIO · Versión 23 (27-nov-2026): uso de conversaciones para mejorar Elio (decisión del usuario, con transparencia).
--  - Plan gratis (Libre): con su aceptación expresa, se guarda una COPIA de cada pregunta y respuesta, ya pasada por el escudo
--    (claves, tarjetas, cuentas y documentos tapados), para mejorar respuestas, temas, errores y entrenamiento propio.
--    Puede revisarla el equipo de FlexGo. Plazo: 18 meses. Se borra al borrar la cuenta. Nunca se vende ni se da a terceros
--    para publicidad. No se usa para perfilar a nadie. No se guardan las conversaciones de crisis.
--  - Planes de pago (Impulso y Ultra): solo métricas anónimas de uso, salvo que la persona active «Ayúdanos a mejorar».
--  - Cuentas que ya existían: deben aceptar el aviso nuevo al entrar. No se aplica hacia atrás.
-- Se ejecuta en el SQL Editor del proyecto «elio». Se puede repetir sin daño.

alter table public.perfiles add column if not exists mejora_acepto timestamptz;
alter table public.perfiles add column if not exists mejora_version text;
alter table public.perfiles add column if not exists mejora_voluntaria boolean not null default false;

create table if not exists public.mejora_muestras (
  id bigserial primary key,
  usuario uuid not null references auth.users on delete cascade,   -- al borrar la cuenta, se borra todo
  plan text not null check (plan in ('libre','impulso','ultra')),
  motor text,
  pregunta text not null check (length(pregunta) <= 12000),
  respuesta text not null check (length(respuesta) <= 40000),
  creado timestamptz not null default now(),
  expira timestamptz not null default now() + interval '18 months'
);
create index if not exists mejora_muestras_expira on public.mejora_muestras (expira);
create index if not exists mejora_muestras_usuario on public.mejora_muestras (usuario, creado desc);
alter table public.mejora_muestras enable row level security;   -- sin políticas: nadie la lee desde la web

-- La persona acepta el aviso de la versión vigente
create or replace function public.elio_aceptar_mejora(version text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Inicia sesión.'; end if;
  if coalesce(version, '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Versión inválida.'; end if;
  update public.perfiles set mejora_acepto = now(), mejora_version = version where id = auth.uid();
end $$;
revoke all on function public.elio_aceptar_mejora(text) from public, anon;
grant execute on function public.elio_aceptar_mejora(text) to authenticated;

-- Planes de pago: «Ayúdanos a mejorar» (voluntario, se puede apagar). Al apagarlo se borran las muestras guardadas por esa vía.
create or replace function public.elio_mejora_voluntaria(activar boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Inicia sesión.'; end if;
  update public.perfiles set mejora_voluntaria = coalesce(activar, false) where id = auth.uid();
  if not coalesce(activar, false) then delete from public.mejora_muestras where usuario = auth.uid() and plan <> 'libre'; end if;
end $$;
revoke all on function public.elio_mejora_voluntaria(boolean) from public, anon;
grant execute on function public.elio_mejora_voluntaria(boolean) to authenticated;

-- Lo que la web necesita saber (sin datos de otros)
create or replace function public.elio_mi_mejora() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('acepto', p.mejora_acepto, 'version', p.mejora_version, 'voluntaria', p.mejora_voluntaria,
    'plan', public.elio_plan(p.id), 'muestras', (select count(*) from public.mejora_muestras m where m.usuario = p.id))
  from public.perfiles p where p.id = auth.uid()
$$;
revoke all on function public.elio_mi_mejora() from public, anon;
grant execute on function public.elio_mi_mejora() to authenticated;

-- Limpieza: borra lo vencido (18 meses)
create or replace function public.elio_limpiar_muestras() returns void
language sql security definer set search_path = public as $$
  delete from public.mejora_muestras where expira < now()
$$;
revoke all on function public.elio_limpiar_muestras() from public, anon, authenticated;

-- Comprobación: 4 filas en «true»
select 'muestras_rls' as que, (select rowsecurity from pg_tables where schemaname='public' and tablename='mejora_muestras') as ok
union all select 'perfil_mejora', exists (select 1 from information_schema.columns where table_schema='public' and table_name='perfiles' and column_name='mejora_acepto')
union all select 'aceptar_no_anon', not has_function_privilege('anon', 'public.elio_aceptar_mejora(text)', 'execute')
union all select 'muestras_cascada', exists (select 1 from pg_constraint where conrelid = 'public.mejora_muestras'::regclass and contype = 'f' and confdeltype = 'c');

-- ELIO · Versión 20 (27-nov-2026): «¿Te sirvió?» debajo de cada respuesta (Buena / Regular / Mala + motivo opcional).
--  - Se guarda SOLO: la valoración, el motivo (corto), el motor usado y la fecha. NUNCA el texto de la pregunta ni de la respuesta.
--  - Una valoración por respuesta (se puede cambiar). La persona solo ve y cambia las suyas.
--  - Resumen semanal para el dueño en el panel (solo administrador con 2FA), sin nombres ni correos.
-- Se ejecuta en el SQL Editor del proyecto «elio». Se puede repetir sin daño.

-- El motor de cada respuesta (lo escribe la función del servidor). Las respuestas antiguas quedan sin motor.
alter table public.mensajes add column if not exists motor text check (motor in ('chispa','pulso','orbita','cumbre'));

create table if not exists public.valoraciones (
  id bigserial primary key,
  usuario uuid not null references auth.users on delete cascade,
  mensaje bigint references public.mensajes on delete set null,
  valor text not null check (valor in ('buena','regular','mala')),
  motivo text check (motivo is null or length(motivo) <= 200),
  motor text,
  creado timestamptz not null default now(),
  unique (usuario, mensaje)
);
create index if not exists valoraciones_creado on public.valoraciones (creado desc);
alter table public.valoraciones enable row level security;
drop policy if exists "valoraciones propias" on public.valoraciones;
create policy "valoraciones propias" on public.valoraciones for select using (usuario = auth.uid());

-- Guardar o cambiar la valoración de UNA respuesta de Elio que sea de la persona
create or replace function public.elio_valorar(m bigint, valor text, motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); mo text; ni text; limpio text;
begin
  if u is null then raise exception 'Inicia sesión.'; end if;
  if valor not in ('buena','regular','mala') then raise exception 'Valoración inválida.'; end if;
  select x.motor, x.nivel into mo, ni from public.mensajes x where x.id = m and x.usuario = u and x.rol = 'assistant';
  if not found then raise exception 'No encontré esa respuesta.'; end if;
  -- Motivo: corto, sin enlaces ni correos ni números largos (por si alguien escribe datos personales)
  limpio := nullif(btrim(regexp_replace(regexp_replace(regexp_replace(coalesce(motivo, ''),
      'https?://\S+|www\.\S+', '[enlace]', 'gi'),
      '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[correo]', 'g'),
      '\d[\d\s-]{6,}\d', '[número]', 'g')), '');
  insert into public.valoraciones (usuario, mensaje, valor, motivo, motor)
  values (u, m, valor, left(limpio, 200), coalesce(mo, case ni when 'rapido' then 'chispa' when 'razonamiento' then 'pulso' else 'orbita' end))
  on conflict (usuario, mensaje) do update set valor = excluded.valor, motivo = excluded.motivo, creado = now();
end $$;
revoke all on function public.elio_valorar(bigint, text, text) from public, anon;
grant execute on function public.elio_valorar(bigint, text, text) to authenticated;

-- Resumen de los últimos 7 días para el dueño (2FA). Sin nombres, correos ni textos de chats.
create or replace function public.elio_admin_valoraciones() returns json
language plpgsql stable security definer set search_path = public as $$
declare desde timestamptz := now() - interval '7 days';
begin
  if not public.elio_es_admin() then raise exception 'Solo administradores'; end if;
  return json_build_object(
    'total', (select count(*) from public.valoraciones where creado >= desde),
    'por_valor', coalesce((select json_object_agg(valor, n) from (select valor, count(*) n from public.valoraciones where creado >= desde group by valor) x), '{}'::json),
    'por_motor', coalesce((select json_agg(x) from (
      select motor, count(*) n,
        count(*) filter (where valor = 'buena') buenas,
        count(*) filter (where valor = 'regular') regulares,
        count(*) filter (where valor = 'mala') malas
      from public.valoraciones where creado >= desde group by motor order by count(*) desc) x), '[]'::json),
    'motivos', coalesce((select json_agg(x) from (
      select valor, motor, motivo, creado from public.valoraciones
      where creado >= desde and motivo is not null and valor <> 'buena' order by creado desc limit 30) x), '[]'::json)
  );
end $$;
revoke all on function public.elio_admin_valoraciones() from public, anon;
grant execute on function public.elio_admin_valoraciones() to authenticated;

-- Comprobación: 4 filas en «true»
select 'valoraciones_rls' as que, (select rowsecurity from pg_tables where schemaname='public' and tablename='valoraciones') as ok
union all select 'mensajes_motor', exists (select 1 from information_schema.columns where table_schema='public' and table_name='mensajes' and column_name='motor')
union all select 'valorar_no_anon', not has_function_privilege('anon', 'public.elio_valorar(bigint, text, text)', 'execute')
union all select 'resumen_2fa', pg_get_functiondef('public.elio_admin_valoraciones()'::regprocedure) like '%elio_es_admin%';

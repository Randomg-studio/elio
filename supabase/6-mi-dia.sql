-- ELIO · Versión 6 (25-nov-2026): Mi día (tareas, recordatorios y resumen de cada mañana).
--  - Cada persona guarda sus tareas (con o sin fecha). Solo ella las ve.
--  - Cupo de tareas activas: Libre 20 · Impulso 200 · Ultra 500.
--  - Resumen por correo a las 7:00 de Lima SOLO si la persona lo activa (planes Impulso y Ultra).
--    Se arma con la base de datos (sin IA, costo cero) y no se envía si ese día no hay nada.
-- Se ejecuta en el SQL Editor del proyecto «elio». Se puede repetir sin daño.

alter table public.perfiles add column if not exists mi_dia_correo boolean not null default false;

create table if not exists public.tareas (
  id bigserial primary key,
  usuario uuid not null default auth.uid() references auth.users on delete cascade,
  texto text not null check (length(texto) between 1 and 200),
  fecha date,
  hora time,
  hecha boolean not null default false,
  hecha_en timestamptz,
  creado timestamptz not null default now()
);
create index if not exists tareas_usuario on public.tareas (usuario, hecha, fecha);

alter table public.tareas enable row level security;
drop policy if exists "tareas propias ver" on public.tareas;
create policy "tareas propias ver" on public.tareas for select using (usuario = auth.uid());
drop policy if exists "tareas propias crear" on public.tareas;
create policy "tareas propias crear" on public.tareas for insert with check (usuario = auth.uid());
drop policy if exists "tareas propias editar" on public.tareas;
create policy "tareas propias editar" on public.tareas for update using (usuario = auth.uid()) with check (usuario = auth.uid());
drop policy if exists "tareas propias borrar" on public.tareas;
create policy "tareas propias borrar" on public.tareas for delete using (usuario = auth.uid());

-- Cupo de tareas activas por plan
create or replace function public.elio_cupo_tareas() returns trigger
language plpgsql security definer set search_path = public as $$
declare tope int := case public.elio_plan(new.usuario) when 'ultra' then 500 when 'impulso' then 200 else 20 end;
begin
  if (select count(*) from public.tareas where usuario = new.usuario and not hecha) >= tope then
    raise exception 'Tienes % tareas pendientes, el máximo de tu plan. Marca algunas como hechas o bórralas.', tope;
  end if;
  return new;
end $$;
revoke all on function public.elio_cupo_tareas() from public, anon, authenticated;
drop trigger if exists elio_cupo_tareas on public.tareas;
create trigger elio_cupo_tareas before insert on public.tareas for each row execute function public.elio_cupo_tareas();

-- Marcar hecha guarda la hora
create or replace function public.elio_tarea_hecha() returns trigger
language plpgsql set search_path = public as $$
begin
  new.hecha_en := case when new.hecha and not old.hecha then now() when not new.hecha then null else old.hecha_en end;
  new.usuario := old.usuario;  -- nadie puede pasar una tarea a otra cuenta
  return new;
end $$;
drop trigger if exists elio_tarea_hecha on public.tareas;
create trigger elio_tarea_hecha before update on public.tareas for each row execute function public.elio_tarea_hecha();

-- Activar o apagar el correo de la mañana (solo planes Impulso y Ultra)
create or replace function public.elio_mi_dia_correo(activar boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if activar and public.elio_plan(auth.uid()) not in ('impulso','ultra') then
    raise exception 'El resumen de cada mañana está en los planes Impulso y Ultra.';
  end if;
  update public.perfiles set mi_dia_correo = activar where id = auth.uid();
end $$;
revoke all on function public.elio_mi_dia_correo(boolean) from public, anon;
grant execute on function public.elio_mi_dia_correo(boolean) to authenticated;

-- Estado de Mi día para la web
create or replace function public.elio_mi_dia_estado() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'correo', p.mi_dia_correo,
    'plan', public.elio_plan(p.id),
    'tope', case public.elio_plan(p.id) when 'ultra' then 500 when 'impulso' then 200 else 20 end,
    'hoy', public.elio_hoy())
  from public.perfiles p where p.id = auth.uid()
$$;
revoke all on function public.elio_mi_dia_estado() from public, anon;
grant execute on function public.elio_mi_dia_estado() to authenticated;

-- ---------- Resumen de cada mañana (7:00 de Lima = 12:00 UTC) ----------
create or replace function public.elio_enviar_mi_dia() returns void
language plpgsql security definer set search_path = '' as $$
declare r record; hoy date := public.elio_hoy(); lista text; plano text; n int := 0;
begin
  for r in
    select p.id, split_part(coalesce(p.nombre, ''), ' ', 1) as nombre, au.email::text as email
    from public.perfiles p join auth.users au on au.id = p.id
    where p.mi_dia_correo and public.elio_plan(p.id) in ('impulso','ultra')
    limit 250   -- tope diario (Brevo gratis: 300 correos al día, compartidos con los demás avisos)
  loop
    select string_agg('<li>' || case when t.fecha < hoy then '<b style="color:#c0392b">Atrasada:</b> ' else '' end
             || public.elio_html(t.texto) || coalesce(' · ' || to_char(t.hora, 'HH24:MI'), '') || '</li>', '' order by t.fecha nulls last, t.hora nulls last),
           string_agg('- ' || case when t.fecha < hoy then 'Atrasada: ' else '' end || t.texto || coalesce(' · ' || to_char(t.hora, 'HH24:MI'), ''), E'\n' order by t.fecha nulls last, t.hora nulls last)
      into lista, plano
      from public.tareas t where t.usuario = r.id and not t.hecha and t.fecha <= hoy;
    declare venc text; venc_plano text;
    begin
      select string_agg('<li>' || public.elio_html(v.que) || ': vence el ' || to_char(v.fecha, 'DD/MM/YYYY') || '</li>', '' order by v.fecha),
             string_agg('- ' || v.que || ': vence el ' || to_char(v.fecha, 'DD/MM/YYYY'), E'\n' order by v.fecha)
        into venc, venc_plano
        from public.vencimientos v where v.usuario = r.id and v.fecha between hoy and hoy + 15;
      if lista is null and venc is null then continue; end if;  -- si no hay nada, no se envía
      perform public.elio_correo(r.email,
        'Tu día con Elio · ' || to_char(hoy, 'DD/MM/YYYY'),
        '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#102449;line-height:1.55"><p>Buenos días'
          || coalesce(nullif(', ' || public.elio_html(r.nombre), ', '), '') || ' ☀️</p>'
          || coalesce('<p><b>Para hoy</b></p><ul>' || lista || '</ul>', '')
          || coalesce('<p><b>Vencimientos de los próximos 15 días</b></p><ul>' || venc || '</ul>', '')
          || '<p><a href="https://elio.flexgogroup.com/" style="display:inline-block;background:#0756d8;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Abrir Mi día</a></p>'
          || '<p style="font-size:12px;color:#5b6b85">Recibes este resumen porque lo activaste en Mi día. Puedes apagarlo ahí mismo (menú Herramientas).</p><p>Elio by FlexGo Group</p></div>',
        'Buenos días' || coalesce(nullif(', ' || r.nombre, ', '), '') || E'.\n\n'
          || coalesce(E'Para hoy:\n' || plano || E'\n\n', '') || coalesce(E'Vencimientos de los próximos 15 días:\n' || venc_plano || E'\n\n', '')
          || E'Abrir Mi día: https://elio.flexgogroup.com\nPuedes apagar este resumen en Mi día (menú Herramientas).\n\nElio by FlexGo Group',
        'elio-mi-dia');
      n := n + 1;
    end;
  end loop;
end $$;
revoke all on function public.elio_enviar_mi_dia() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'elio-mi-dia';
select cron.schedule('elio-mi-dia', '0 12 * * *', 'select public.elio_enviar_mi_dia()');

-- Comprobación: 4 filas en «true»
select 'tabla_rls' as que, (select rowsecurity from pg_tables where schemaname='public' and tablename='tareas') as ok
union all select 'cupo', exists(select 1 from pg_trigger where tgname = 'elio_cupo_tareas' and not tgisinternal)
union all select 'permiso_correo', exists(select 1 from information_schema.columns where table_name='perfiles' and column_name='mi_dia_correo')
union all select 'correo_7am', exists(select 1 from cron.job where jobname = 'elio-mi-dia');

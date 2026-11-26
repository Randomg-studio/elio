-- ELIO · Versión 5 (25-nov-2026): Biblioteca (segundo cerebro).
--  - Cada persona sube sus PDF e imágenes de documentos a una carpeta privada (solo ella puede leerla).
--  - Elio guarda el texto en trozos, un resumen corto y las fechas importantes (vencimientos).
--  - Las preguntas buscan en sus documentos con la búsqueda de texto de Postgres (español) y citan la fuente.
--  - Avisos de vencimiento por correo SOLO si la persona los activa.
--  - Los documentos NO alimentan el perfil de intereses. El administrador nunca puede leerlos.
-- Se ejecuta en el SQL Editor del proyecto «elio». Se puede repetir sin daño.

-- ---------- Carpeta privada de archivos ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('biblioteca', 'biblioteca', false, 20971520, array['application/pdf','image/png','image/jpeg','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 20971520,
  allowed_mime_types = array['application/pdf','image/png','image/jpeg','image/webp'];

drop policy if exists "biblioteca subir propia" on storage.objects;
create policy "biblioteca subir propia" on storage.objects for insert to authenticated
  with check (bucket_id = 'biblioteca' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "biblioteca ver propia" on storage.objects;
create policy "biblioteca ver propia" on storage.objects for select to authenticated
  using (bucket_id = 'biblioteca' and (storage.foldername(name))[1] = auth.uid()::text);
-- Borrar: solo desde la función del servidor (borra archivo, trozos y fechas juntos).

-- ---------- Tablas ----------
create table if not exists public.documentos (
  id uuid primary key default gen_random_uuid(),
  usuario uuid not null references auth.users on delete cascade,
  nombre text not null check (length(nombre) between 1 and 120),
  tipo text not null,
  bytes int not null,
  paginas int not null default 0,
  ruta text not null,
  resumen text,
  estado text not null default 'procesando' check (estado in ('procesando','listo','error')),
  error text,
  creado timestamptz not null default now()
);
create index if not exists documentos_usuario on public.documentos (usuario, creado desc);

create table if not exists public.trozos (
  id bigserial primary key,
  documento uuid not null references public.documentos on delete cascade,
  usuario uuid not null references auth.users on delete cascade,
  n int not null,
  pagina int,
  texto text not null,
  tsv tsvector generated always as (to_tsvector('spanish', texto)) stored
);
create index if not exists trozos_tsv on public.trozos using gin (tsv);
create index if not exists trozos_usuario on public.trozos (usuario);

create table if not exists public.vencimientos (
  id bigserial primary key,
  usuario uuid not null references auth.users on delete cascade,
  documento uuid references public.documentos on delete cascade,
  que text not null check (length(que) between 2 and 120),
  fecha date not null,
  avisar boolean not null default false,
  dias_antes int not null default 15 check (dias_antes between 1 and 90),
  avisado timestamptz,
  creado timestamptz not null default now()
);
create index if not exists vencimientos_aviso on public.vencimientos (fecha) where avisar and avisado is null;

-- Cupos de la biblioteca por día (preguntas) y por mes (páginas leídas)
alter table public.uso add column if not exists preguntas_biblioteca int not null default 0;
alter table public.uso add column if not exists paginas_leidas int not null default 0;
alter table public.gasto_dia add column if not exists biblioteca_usd numeric(12,6) not null default 0;

alter table public.documentos enable row level security;
alter table public.trozos enable row level security;
alter table public.vencimientos enable row level security;
drop policy if exists "documentos propios" on public.documentos;
create policy "documentos propios" on public.documentos for select using (usuario = auth.uid());
drop policy if exists "vencimientos propios" on public.vencimientos;
create policy "vencimientos propios" on public.vencimientos for select using (usuario = auth.uid());
-- trozos: sin políticas (solo la función del servidor los lee).

-- Activar o apagar el aviso de un vencimiento (solo el dueño)
create or replace function public.elio_aviso_vencimiento(v bigint, activar boolean, dias int default 15) returns void
language sql security definer set search_path = public as $$
  update public.vencimientos set avisar = activar, dias_antes = greatest(1, least(90, dias)), avisado = case when activar then null else avisado end
  where id = v and usuario = auth.uid()
$$;
revoke all on function public.elio_aviso_vencimiento(bigint, boolean, int) from public, anon;
grant execute on function public.elio_aviso_vencimiento(bigint, boolean, int) to authenticated;

-- Búsqueda en los documentos de UNA persona (solo la función del servidor)
create or replace function public.elio_buscar_trozos(u uuid, q text, lim int default 6)
returns table (documento uuid, nombre text, pagina int, texto text, rango real)
language sql stable security definer set search_path = public as $$
  with consulta as (
    select websearch_to_tsquery('spanish', q) as estricta,
           to_tsquery('spanish', coalesce(nullif(array_to_string(array(
             select lexeme from unnest(to_tsvector('spanish', q))), ' | '), ''), 'xyzxyz')) as amplia
  )
  select t.documento, d.nombre, t.pagina, t.texto,
         greatest(ts_rank(t.tsv, c.estricta) * 2, ts_rank(t.tsv, c.amplia)) as rango
  from public.trozos t join public.documentos d on d.id = t.documento, consulta c
  where t.usuario = u and (t.tsv @@ c.estricta or t.tsv @@ c.amplia)
  order by rango desc
  limit greatest(1, least(lim, 10))
$$;
revoke all on function public.elio_buscar_trozos(uuid, text, int) from public, anon, authenticated;

-- Sumar uso y gasto de la biblioteca (solo la función del servidor)
create or replace function public.elio_sumar_biblioteca(u uuid, preguntas int, paginas int, costo numeric, es_libre boolean) returns void
language plpgsql security definer set search_path = public as $$
declare d date := public.elio_hoy();
begin
  insert into public.uso (usuario, dia) values (u, d) on conflict do nothing;
  update public.uso set preguntas_biblioteca = preguntas_biblioteca + preguntas, paginas_leidas = paginas_leidas + paginas,
    costo_usd = costo_usd + costo where usuario = u and dia = d;
  insert into public.gasto_dia (dia) values (d) on conflict do nothing;
  update public.gasto_dia set total_usd = total_usd + costo, biblioteca_usd = biblioteca_usd + costo,
    libre_usd = libre_usd + case when es_libre then costo else 0 end where dia = d;
end $$;
revoke all on function public.elio_sumar_biblioteca(uuid, int, int, numeric, boolean) from public, anon, authenticated;

-- ---------- Avisos de vencimiento por correo (cada día a las 8:00 de Lima = 13:00 UTC) ----------
create or replace function public.elio_avisar_vencimientos() returns void
language plpgsql security definer set search_path = '' as $$
declare r record; enviados int := 0;
begin
  for r in
    select v.id, v.que, v.fecha, au.email::text as email, p.nombre, d.nombre as doc
    from public.vencimientos v
    join auth.users au on au.id = v.usuario
    join public.perfiles p on p.id = v.usuario
    left join public.documentos d on d.id = v.documento
    where v.avisar and v.avisado is null and v.fecha - v.dias_antes <= public.elio_hoy() and v.fecha >= public.elio_hoy()
    order by v.fecha limit 250   -- tope diario (el plan gratis de Brevo envía 300 al día)
  loop
    perform public.elio_correo(r.email,
      'Elio: ' || r.que || ' vence el ' || to_char(r.fecha, 'DD/MM/YYYY'),
      '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#102449;line-height:1.55"><p>Hola'
        || coalesce(' ' || public.elio_html(split_part(r.nombre, ' ', 1)), '') || ',</p><p>Te recuerdo que <b>' || public.elio_html(r.que)
        || '</b> vence el <b>' || to_char(r.fecha, 'DD/MM/YYYY') || '</b>'
        || coalesce(' (según tu documento «' || public.elio_html(r.doc) || '»)', '') || '.</p>'
        || '<p><a href="https://elio.flexgogroup.com/" style="display:inline-block;background:#0756d8;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Abrir mi Biblioteca</a></p>'
        || '<p style="font-size:12px;color:#5b6b85">Recibes este aviso porque lo activaste en tu Biblioteca de Elio. Puedes apagarlo ahí mismo.</p><p>Elio by FlexGo Group</p></div>',
      'Hola, te recuerdo que ' || r.que || ' vence el ' || to_char(r.fecha, 'DD/MM/YYYY') || coalesce(' (según tu documento «' || r.doc || '»)', '')
        || E'.\n\nAbre tu Biblioteca: https://elio.flexgogroup.com\nRecibes este aviso porque lo activaste; puedes apagarlo en tu Biblioteca.\n\nElio by FlexGo Group',
      'elio-vencimiento');
    update public.vencimientos set avisado = now() where id = r.id;
    enviados := enviados + 1;
  end loop;
end $$;
revoke all on function public.elio_avisar_vencimientos() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'elio-avisos-vencimiento';
select cron.schedule('elio-avisos-vencimiento', '0 13 * * *', 'select public.elio_avisar_vencimientos()');

-- Comprobación: 5 filas en «true»
select 'carpeta_privada' as que, exists(select 1 from storage.buckets where id = 'biblioteca' and not public) as ok
union all select 'tablas_rls', (select bool_and(rowsecurity) from pg_tables where schemaname='public' and tablename in ('documentos','trozos','vencimientos'))
union all select 'busqueda_cerrada', not has_function_privilege('authenticated', 'public.elio_buscar_trozos(uuid, text, int)', 'execute')
union all select 'cupos', exists(select 1 from information_schema.columns where table_name='uso' and column_name='preguntas_biblioteca')
union all select 'avisos_diarios', exists(select 1 from cron.job where jobname = 'elio-avisos-vencimiento');

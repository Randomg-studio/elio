-- ELIO · Versión 12 (26-nov-2026): créditos según el costo real y «modo MarkItDown» para los PDF del chat.
--  - Cada mensaje reserva los créditos estimados y, al terminar, cobra los reales (costo ÷ US$ 0,0025, con el mínimo del motor).
--  - Los PDF adjuntos en el chat se guardan como texto en la Biblioteca de la persona; la conversación recuerda qué documentos usa
--    y en cada mensaje solo se envían a la IA los fragmentos que sirven (mucho más barato que enviar el PDF entero).
-- Se ejecuta en el SQL Editor del proyecto «elio». Se puede repetir sin daño.

alter table public.conversaciones add column if not exists documentos uuid[] not null default '{}';

-- Cierra el consumo con los créditos reales (o los devuelve si no hubo respuesta)
create or replace function public.elio_cobrar_consumo(c bigint, costo numeric, creditos int) returns void
language sql security definer set search_path = public as $$
  update public.consumo set costo_usd = costo, creditos = greatest(0, creditos) where id = c
$$;
revoke all on function public.elio_cobrar_consumo(bigint, numeric, int) from public, anon, authenticated;

-- Fragmentos de ciertos documentos de UNA persona (los adjuntos de una conversación)
create or replace function public.elio_buscar_en_docs(u uuid, q text, docs uuid[], lim int default 6)
returns table (documento uuid, nombre text, pagina int, texto text, n int)
language sql stable security definer set search_path = public as $$
  with consulta as (
    select websearch_to_tsquery('spanish', q) as estricta,
           to_tsquery('spanish', coalesce(nullif(array_to_string(array(
             select lexeme from unnest(to_tsvector('spanish', coalesce(q, '')))), ' | '), ''), 'xyzxyz')) as amplia
  ), hallados as (
    select t.documento, d.nombre, t.pagina, t.texto, t.n,
           greatest(ts_rank(t.tsv, c.estricta) * 2, ts_rank(t.tsv, c.amplia)) as rango
    from public.trozos t join public.documentos d on d.id = t.documento, consulta c
    where t.usuario = u and t.documento = any(docs) and (t.tsv @@ c.estricta or t.tsv @@ c.amplia)
    order by rango desc limit greatest(1, least(lim, 10))
  )
  select documento, nombre, pagina, texto, n from hallados
  union all   -- si la pregunta no coincide con nada (p. ej. «resúmelo»), el inicio de cada documento
  select t.documento, d.nombre, t.pagina, t.texto, t.n
  from public.trozos t join public.documentos d on d.id = t.documento
  where t.usuario = u and t.documento = any(docs) and t.n < 4 and not exists (select 1 from hallados)
$$;
revoke all on function public.elio_buscar_en_docs(uuid, text, uuid[], int) from public, anon, authenticated;

-- Comprobación: 3 filas en «true»
select 'conv_documentos' as que, exists(select 1 from information_schema.columns where table_name='conversaciones' and column_name='documentos') as ok
union all select 'cobro_real', exists(select 1 from pg_proc where proname = 'elio_cobrar_consumo')
union all select 'buscar_cerrado', not has_function_privilege('authenticated', 'public.elio_buscar_en_docs(uuid, text, uuid[], int)', 'execute');

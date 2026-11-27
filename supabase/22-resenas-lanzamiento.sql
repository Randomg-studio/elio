-- ELIO · Versión 22 (27-nov-2026): reseñas para el lanzamiento.
--  - Cualquiera con cuenta (correo) puede dejar su reseña. El mínimo de 3 mensajes vuelve SOLO cuando haya 10 reseñas aprobadas.
--  - Se mantiene: una reseña por cuenta, la moderación del dueño, sin enlaces, 10 minutos entre cambios y el promedio desde 3 reseñas.
-- Se ejecuta en el SQL Editor del proyecto «elio». Se puede repetir sin daño.

create or replace function public.elio_guardar_resena(estrellas int, texto text, publicar boolean) returns json
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); n text; t text := btrim(regexp_replace(coalesce(texto, ''), '\s+', ' ', 'g')); ult timestamptz;
begin
  if u is null then raise exception 'Inicia sesión para dejar tu reseña.'; end if;
  if not coalesce(publicar, false) then raise exception 'Marca la casilla para permitir que mostremos tu reseña.'; end if;
  if estrellas is null or estrellas not between 1 and 5 then raise exception 'Elige de 1 a 5 estrellas.'; end if;
  if length(t) < 10 then raise exception 'Escribe al menos 10 letras.'; end if;
  if length(t) > 500 then raise exception 'Máximo 500 letras.'; end if;
  if t ~* '(https?://|www\.)' then raise exception 'La reseña no puede llevar enlaces.'; end if;
  -- Lanzamiento (decisión del usuario, 27-nov): el mínimo de 3 mensajes solo se exige cuando Elio ya tiene 10 reseñas aprobadas.
  if (select count(*) from public.resenas where estado = 'aprobada') >= 10
     and (select count(*) from public.consumo where usuario = u and funcion in ('chat','probadita')) < 3 then
    raise exception 'Usa Elio un poco más (al menos 3 mensajes) antes de dejar tu reseña.';
  end if;
  select actualizado into ult from public.resenas where usuario = u;
  if ult is not null and ult > now() - interval '10 minutes' then raise exception 'Espera unos minutos para volver a cambiar tu reseña.'; end if;
  -- Nombre corto: primer nombre + inicial del apellido (nunca el correo)
  select coalesce(nullif(split_part(btrim(nombre), ' ', 1), ''), 'Usuario') ||
         coalesce(' ' || nullif(left(split_part(btrim(nombre), ' ', 2), 1), '') || '.', '')
    into n from public.perfiles where id = u;
  insert into public.resenas (usuario, estrellas, texto, nombre_publico, plan)
    values (u, estrellas, t, left(coalesce(n, 'Usuario'), 40), public.elio_plan(u))
  on conflict (usuario) do update set estrellas = excluded.estrellas, texto = excluded.texto,
    nombre_publico = excluded.nombre_publico, plan = excluded.plan, estado = 'pendiente', actualizado = now(), moderado = null;
  return json_build_object('ok', true, 'estado', 'pendiente');
end $$;
revoke all on function public.elio_guardar_resena(int, text, boolean) from public, anon;
grant execute on function public.elio_guardar_resena(int, text, boolean) to authenticated;

-- Comprobación: 2 filas en «true»
select 'regla_10_aprobadas' as que, pg_get_functiondef('public.elio_guardar_resena(int, text, boolean)'::regprocedure) like '%>= 10%' as ok
union all select 'guardar_no_anon', not has_function_privilege('anon', 'public.elio_guardar_resena(int, text, boolean)', 'execute');

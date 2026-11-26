-- ELIO · Versión 3 (25-nov-2026): seguridad de las 10 capas.
--  1) Correo a pagos@flexgogroup.com cada vez que alguien avisa un pago por Yape.
--  2) Correo de control el día 1 de cada mes con la misma clave (así la clave de Brevo no vence por falta de uso).
--  3) Máximo 3 avisos de pago pendientes y 5 por día por persona (nadie puede llenar el correo de avisos falsos).
--  4) El panel de administración exige la verificación en dos pasos (2FA, nivel «aal2»).
--
-- ANTES de ejecutarlo: guarda la clave API de Brevo en Supabase › Integrations › Vault › «Add new secret»
--   Name: brevo_api_key     Secret: (la pegas tú; nunca va en este archivo ni en el chat)
-- Se ejecuta en el SQL Editor del proyecto «elio». Se puede repetir sin daño.
-- Si el correo falla, el pago se guarda igual: el aviso nunca bloquea al cliente.

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ---------- Clave de Brevo (solo la leen las funciones internas) ----------
create or replace function public.elio_brevo_clave() returns text
language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'brevo_api_key' limit 1
$$;
revoke all on function public.elio_brevo_clave() from public, anon, authenticated;

create or replace function public.elio_html(t text) returns text
language sql immutable set search_path = '' as $$
  select replace(replace(replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;')
$$;

-- Envía un correo con la API de Brevo. Nunca lanza error.
create or replace function public.elio_correo(para text, asunto text, html text, texto text, etiqueta text) returns void
language plpgsql security definer set search_path = '' as $$
declare k text := public.elio_brevo_clave();
begin
  if k is null then raise warning 'elio_correo: falta brevo_api_key en el Vault'; return; end if;
  perform net.http_post(
    url := 'https://api.brevo.com/v3/smtp/email',
    body := jsonb_build_object(
      'sender', jsonb_build_object('name', 'Elio by FlexGo Group', 'email', 'noreply@flexgogroup.com'),
      'to', jsonb_build_array(jsonb_build_object('email', para)),
      'subject', asunto, 'htmlContent', html, 'textContent', texto,
      'tags', jsonb_build_array(etiqueta)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'accept', 'application/json', 'api-key', k),
    timeout_milliseconds := 20000);
exception when others then
  raise warning 'elio_correo: no salió el correo: %', sqlerrm;
end $$;
revoke all on function public.elio_correo(text, text, text, text, text) from public, anon, authenticated;

-- ---------- 1) Aviso de pago nuevo ----------
create or replace function public.elio_aviso_pago() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_email text; v_nombre text; plan_txt text := initcap(new.plan); asunto text; html text; plano text;
begin
  select u.email::text into v_email from auth.users u where u.id = new.usuario;
  select p.nombre into v_nombre from public.perfiles p where p.id = new.usuario;
  asunto := 'Elio: nuevo pago por Yape de S/ ' || to_char(new.monto, 'FM999990.00') || ' (' || plan_txt || ')';
  plano := E'Hola,\n\nUna persona avisó que pagó por Yape y espera que actives su plan de Elio.\n\n'
    || '- Cliente: ' || coalesce(v_nombre, '—') || ' · ' || coalesce(v_email, '—') || E'\n'
    || '- Plan: ' || plan_txt || ' · ' || new.meses || E' mes(es)\n'
    || '- Monto: S/ ' || to_char(new.monto, 'FM999990.00') || E'\n'
    || '- N.º de operación: ' || new.operacion || E'\n\n'
    || E'Comprueba en tu Yape que el pago llegó antes de aprobarlo.\n'
    || E'Apruébalo en https://elio.flexgogroup.com (menú de tu cuenta › Panel de administración).\n\nElio by FlexGo Group';
  html := '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#102449;line-height:1.55">'
    || '<p>Hola,</p><p>Una persona avisó que pagó por <b>Yape</b> y espera que actives su plan de Elio.</p>'
    || '<table role="presentation" style="width:100%;border-collapse:collapse;margin:16px 0">'
    || '<tr><td style="padding:10px;border:1px solid #DCE3EE">Cliente</td><td style="padding:10px;border:1px solid #DCE3EE"><b>'
    || public.elio_html(coalesce(v_nombre, '—')) || '</b> · ' || public.elio_html(coalesce(v_email, '—')) || '</td></tr>'
    || '<tr><td style="padding:10px;border:1px solid #DCE3EE">Plan</td><td style="padding:10px;border:1px solid #DCE3EE">'
    || public.elio_html(plan_txt) || ' · ' || new.meses || ' mes(es)</td></tr>'
    || '<tr><td style="padding:10px;border:1px solid #DCE3EE">Monto</td><td style="padding:10px;border:1px solid #DCE3EE"><b>S/ '
    || to_char(new.monto, 'FM999990.00') || '</b></td></tr>'
    || '<tr><td style="padding:10px;border:1px solid #DCE3EE">N.º de operación</td><td style="padding:10px;border:1px solid #DCE3EE">'
    || public.elio_html(new.operacion) || '</td></tr></table>'
    || '<p>Comprueba en tu Yape que el pago llegó antes de aprobarlo.</p>'
    || '<p><a href="https://elio.flexgogroup.com/" style="display:inline-block;background:#0756d8;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Abrir el panel de Elio</a></p>'
    || '<p>Elio by FlexGo Group</p></div>';
  perform public.elio_correo('pagos@flexgogroup.com', asunto, html, plano, 'elio-pago');
  return null;
end $$;
revoke all on function public.elio_aviso_pago() from public, anon, authenticated;

drop trigger if exists elio_aviso_pago on public.pagos;
create trigger elio_aviso_pago after insert on public.pagos
  for each row execute function public.elio_aviso_pago();

-- ---------- 2) Control mensual de la clave (día 1, 9:05 a. m. de Lima = 14:05 UTC) ----------
create or replace function public.elio_control_brevo() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.elio_correo('pagos@flexgogroup.com',
    'Elio · Prueba mensual de los avisos de pago ✔',
    '<div style="font-family:Arial,Helvetica,sans-serif;color:#102449"><p>Hola,</p><p>Este correo llega el día 1 de cada mes para comprobar que los <b>avisos de pagos por Yape de Elio</b> funcionan y que la clave de Brevo sigue activa.</p><p>Si este mes no te llegó, revisa la clave <b>brevo_api_key</b> en el Vault de Supabase (proyecto elio).</p><p>Elio by FlexGo Group</p></div>',
    E'Hola,\n\nEste correo llega el día 1 de cada mes para comprobar que los avisos de pagos por Yape de Elio funcionan y que la clave de Brevo sigue activa.\nSi este mes no te llegó, revisa la clave brevo_api_key en el Vault de Supabase (proyecto elio).\n\nElio by FlexGo Group',
    'elio-control');
end $$;
revoke all on function public.elio_control_brevo() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'elio-control-brevo';
select cron.schedule('elio-control-brevo', '5 14 1 * *', 'select public.elio_control_brevo()');

-- ---------- 3) Freno a los avisos de pago repetidos ----------
create or replace function public.elio_freno_pagos() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.pagos where usuario = new.usuario and estado = 'pendiente') >= 3 then
    raise exception 'Ya tienes 3 pagos esperando revisión. Te avisaremos apenas los revisemos.';
  end if;
  if (select count(*) from public.pagos where usuario = new.usuario and creado > now() - interval '1 day') >= 5 then
    raise exception 'Hoy ya enviaste varios avisos de pago. Inténtalo mañana o escríbenos por WhatsApp.';
  end if;
  return new;
end $$;
revoke all on function public.elio_freno_pagos() from public, anon, authenticated;

drop trigger if exists elio_freno_pagos on public.pagos;
create trigger elio_freno_pagos before insert on public.pagos
  for each row execute function public.elio_freno_pagos();

-- ---------- 4) Administración solo con verificación en dos pasos ----------
create or replace function public.elio_es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select es_admin from public.perfiles where id = auth.uid()), false)
     and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

-- Comprobación: 5 filas en «true» (la primera es «false» si aún no guardaste la clave en el Vault)
select 'clave_brevo' as que, public.elio_brevo_clave() is not null as ok
union all select 'aviso_pago', exists(select 1 from pg_trigger where tgname = 'elio_aviso_pago' and not tgisinternal)
union all select 'freno_pagos', exists(select 1 from pg_trigger where tgname = 'elio_freno_pagos' and not tgisinternal)
union all select 'control_mensual', exists(select 1 from cron.job where jobname = 'elio-control-brevo')
union all select 'admin_2fa', pg_get_functiondef('public.elio_es_admin()'::regprocedure) like '%aal2%';

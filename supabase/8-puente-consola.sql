-- ELIO · Versión 8 (25-nov-2026): puente Elio → Consola madre (solo la cuenta del dueño).
--  - Las tareas guardan su tipo (tarea, pago, suscripción, recordatorio) y, si aplica, monto, moneda, proveedor y frecuencia.
--  - «puente» indica si ya se envió a la consola: null = no aplica (no es el dueño), pendiente, enviado, sensible, error.
-- Se ejecuta en el SQL Editor del proyecto «elio». Se puede repetir sin daño.

alter table public.tareas add column if not exists tipo text not null default 'tarea'
  check (tipo in ('tarea','pago','suscripcion','recordatorio'));
alter table public.tareas add column if not exists monto numeric(12,2);
alter table public.tareas add column if not exists moneda text check (moneda in ('PEN','USD'));
alter table public.tareas add column if not exists proveedor text check (length(proveedor) <= 80);
alter table public.tareas add column if not exists frecuencia text check (frecuencia in ('unica','mensual','anual'));
alter table public.tareas add column if not exists puente text check (puente in ('pendiente','enviado','sensible','error'));
alter table public.tareas add column if not exists puente_intentos int not null default 0;
create index if not exists tareas_puente_pendiente on public.tareas (usuario) where puente = 'pendiente';

-- Comprobación: 2 filas en «true»
select 'columnas' as que, exists(select 1 from information_schema.columns where table_name='tareas' and column_name='frecuencia') as ok
union all select 'puente', exists(select 1 from information_schema.columns where table_name='tareas' and column_name='puente');

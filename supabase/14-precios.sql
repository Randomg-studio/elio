-- ELIO · Versión 14 (26-nov-2026): precios finales con IGV incluido (Impulso S/ 56.99 · Ultra S/ 159.99).
--  - El monto de cada aviso de pago lo pone la base de datos según el plan (la web no puede cambiarlo).
-- Se ejecuta en el SQL Editor del proyecto «elio». Se puede repetir sin daño.

create or replace function public.elio_precio(p text) returns numeric
language sql immutable as $$ select case p when 'ultra' then 159.99 when 'impulso' then 56.99 else 0 end $$;

create or replace function public.elio_monto_pago() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.monto := public.elio_precio(new.plan) * new.meses;
  return new;
end $$;
revoke all on function public.elio_monto_pago() from public, anon, authenticated;
drop trigger if exists elio_monto_pago on public.pagos;
create trigger elio_monto_pago before insert on public.pagos for each row execute function public.elio_monto_pago();

-- Comprobación: 2 filas en «true»
select 'precios' as que, public.elio_precio('impulso') = 56.99 and public.elio_precio('ultra') = 159.99 as ok
union all select 'monto_protegido', exists(select 1 from pg_trigger where tgname = 'elio_monto_pago' and not tgisinternal);

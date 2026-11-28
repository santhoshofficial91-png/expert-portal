-- No duplicate suppliers: same GST number, or same name ignoring dots / spaces / case
-- (J.D.Enterprises = J.D enterprises). Same name is allowed only when both have different GST numbers (branches in other states).
create or replace function public.pr_sup_nodup() returns trigger language plpgsql set search_path = public as $$
declare g text := upper(coalesce(trim(new.gstin), '')); k text := lower(regexp_replace(coalesce(new.name, ''), '[^a-zA-Z0-9]', '', 'g')); x record;
begin
  if g <> '' then
    select name into x from public.pr_suppliers where id <> new.id and upper(trim(gstin)) = g limit 1;
    if found then raise exception 'This GST number is already in the supplier list as "%"', x.name; end if;
  end if;
  select name, gstin into x from public.pr_suppliers where id <> new.id and lower(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g')) = k
    and not (g <> '' and coalesce(trim(gstin), '') <> '' and upper(trim(gstin)) <> g) limit 1;
  if found then raise exception 'This supplier is already in the list as "%"', x.name; end if;
  return new;
end $$;
drop trigger if exists pr_sup_nodup on public.pr_suppliers;
create trigger pr_sup_nodup before insert or update of name, gstin on public.pr_suppliers for each row execute function public.pr_sup_nodup();

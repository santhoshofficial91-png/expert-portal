-- POs sent from Tally (tally-po → tally_po_receive) also go to the PO Master (pr_po).
-- A PO number already in the PO Master is left exactly as it is (same rule as po_master_add).
create or replace function public.po_master_from_doc(p_doc jsonb, p_src text)
returns text language plpgsql security definer set search_path = public as $$
declare v_no text := trim(coalesce(p_doc->>'no','')); v_val numeric; v_date text; d date;
begin
  if v_no = '' then return 'skipped'; end if;
  if exists (select 1 from public.pr_po where lower(trim(po_num)) = lower(v_no)) then return 'exists'; end if;
  -- the printed PO total (with GST); else rows + GST
  v_val := coalesce(nullif(p_doc->>'aiTotal','')::numeric,
    (select round(sum(coalesce((l->>'value')::numeric,0) * (1 + coalesce((l->>'gst')::numeric,0)/100)), 2) from jsonb_array_elements(p_doc->'lines') l), 0);
  begin d := (p_doc->>'date')::date; v_date := to_char(d, 'DD-Mon-YY'); exception when others then v_date := coalesce(p_doc->>'date',''); end;
  insert into public.pr_po(enq, po_date, supplier, po_num, po_value, paid, balance, requester, src)
  values (coalesce(p_doc->>'enq',''), v_date, coalesce(p_doc->>'supName',''), v_no, v_val, 0, v_val, coalesce(p_doc->>'execName',''), p_src);
  return 'added';
end $$;
revoke all on function public.po_master_from_doc(jsonb, text) from public, anon, authenticated;
grant execute on function public.po_master_from_doc(jsonb, text) to service_role;

-- edits from the portal may also change PO Master rows that came from Tally
create or replace function public.po_master_edit(p_old text, p_po text, p_enq text, p_date text, p_sup text, p_value numeric)
returns text language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not (public.my_can_stock() or public.pr_my_role() in ('admin','manager')) then raise exception 'Not allowed'; end if;
  p_po := trim(coalesce(p_po,'')); if p_po = '' then raise exception 'PO number is required'; end if;
  select * into r from public.pr_po where lower(trim(po_num)) = lower(trim(coalesce(p_old, p_po))) and src in ('portal_po','tally_po') limit 1;
  if not found then return 'none'; end if;
  if lower(p_po) <> lower(trim(r.po_num)) and exists (select 1 from public.pr_po where lower(trim(po_num)) = lower(p_po)) then return 'clash'; end if;
  update public.pr_po set po_num = p_po, enq = coalesce(trim(p_enq),''), po_date = coalesce(nullif(trim(p_date),''), po_date), supplier = coalesce(nullif(trim(p_sup),''), supplier),
    po_value = coalesce(p_value, po_value), balance = coalesce(p_value, po_value) - coalesce(paid,0)
  where n = r.n;
  return 'updated';
end $$;

-- tally_po_receive: after saving the PO in the register, add it to the PO Master
do $do$ declare d text; begin
  d := pg_get_functiondef('public.tally_po_receive'::regproc);
  if position('po_master_from_doc' in d) = 0 then
    if position($r$  return jsonb_build_object('status','created','id',v_id);$r$ in d) = 0 then raise exception 'tally_po_receive changed; patch point not found'; end if;
    d := replace(d, $r$  return jsonb_build_object('status','created','id',v_id);$r$,
$r$  -- PO Master (Purchase): add when the PO number is not there yet; never change an existing row
  declare v_pm text; begin
    v_pm := public.po_master_from_doc(v_doc, 'tally_po');
    update public.docs set data = jsonb_set(data, '{tally,poMasterStatus}', to_jsonb(v_pm)) where col = 'mat_po' and id = v_id;
  end;
  return jsonb_build_object('status','created','id',v_id);$r$);
    execute d;
  end if;
end $do$;

-- the portal reads who raised a PO in the PO Master (to fill the executive)
create or replace function public.po_master_info(p_po text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when (public.my_can_stock() or public.pr_my_role() in ('admin','manager')) then
    (select jsonb_build_object('requester', requester, 'po_value', po_value) from public.pr_po where lower(trim(po_num)) = lower(trim(coalesce(p_po,''))) limit 1) end;
$$;
revoke all on function public.po_master_info(text) from public, anon;
grant execute on function public.po_master_info(text) to authenticated;

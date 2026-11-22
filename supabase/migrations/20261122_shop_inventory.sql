-- Trailer Shop Inventory (Transportation Manager v2.8.0 / Trailer Shop v1.3.0)
-- Parts list + every stock movement. On hand is kept on the part row and every change writes a move row,
-- so you can always see why a count changed.
--
-- Who can do what:
--   * Shop techs (Trailer Shop app, no sign-in, same as the rest of the tech app):
--       shop_parts_list()            stock lookup (no costs)
--       shop_session_parts(key)      parts already saved on an open repair session
--       shop_use_parts(...)          parts used on a repair session -> deducts stock
--   * Managers (Transportation Manager sign-in token, role = Manager in drivers):
--       shop_inv_list, shop_inv_save_part, shop_inv_move (receive / adjust / count),
--       shop_inv_history, shop_inv_import
-- Tables have RLS on with no policies: everything goes through these functions.

create table if not exists public.shop_parts (
  id            bigserial primary key,
  part_no       text,
  description   text not null,
  category      text,
  bin           text,
  uom           text not null default 'each',
  on_hand       numeric not null default 0,
  reorder_point numeric,
  reorder_qty   numeric,
  unit_cost     numeric,
  vendor        text,
  notes         text,
  active        boolean not null default true,
  counted_at    timestamptz,          -- null = never physically counted
  counted_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    text
);
create unique index if not exists shop_parts_part_no_uq on public.shop_parts (upper(part_no)) where part_no is not null and part_no <> '';
create index if not exists shop_parts_desc_ix on public.shop_parts (lower(description));
alter table public.shop_parts enable row level security;

create table if not exists public.shop_stock_moves (
  id            bigserial primary key,
  part_id       bigint not null references public.shop_parts(id),
  at            timestamptz not null default now(),
  kind          text not null check (kind in ('receive','use','adjust','count','import')),
  qty           numeric not null,     -- signed change to on hand
  on_hand_after numeric not null,
  session_key   text,                 -- repair session (RepairLog Log ID) for 'use'
  wo_number     text,
  trailer       text,
  tech          text,
  po_number     text,
  vendor        text,
  unit_cost     numeric,
  note          text,
  by_name       text
);
create index if not exists shop_moves_part_ix on public.shop_stock_moves (part_id, at desc);
create index if not exists shop_moves_at_ix on public.shop_stock_moves (at desc);
create index if not exists shop_moves_session_ix on public.shop_stock_moves (session_key) where session_key is not null;
alter table public.shop_stock_moves enable row level security;

-- The full parts list a tech last saved on a repair session (stocked and free-text), so reopening
-- the job shows what was already entered instead of blank rows.
create table if not exists public.shop_session_parts (
  session_key text primary key,
  wo_number   text,
  trailer     text,
  tech        text,
  parts       jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);
alter table public.shop_session_parts enable row level security;

-- ---------- helpers ----------
create or replace function public.shop_mgr_name(p_token text)
 returns text language sql stable security definer set search_path to 'public'
as $$
  select coalesce(nullif(d.goes_by,''), d.name) from drivers d where d.driver_id = drv_session_manager(p_token);
$$;

create or replace function public.shop_part_json(p public.shop_parts, p_cost boolean)
 returns jsonb language sql immutable
as $$
  select jsonb_build_object('id',p.id,'part_no',p.part_no,'description',p.description,'category',p.category,'bin',p.bin,
    'uom',p.uom,'on_hand',p.on_hand,'reorder_point',p.reorder_point,'active',p.active,'counted_at',p.counted_at,
    'low', p.reorder_point is not null and p.on_hand <= p.reorder_point)
  || case when p_cost then jsonb_build_object('reorder_qty',p.reorder_qty,'unit_cost',p.unit_cost,'vendor',p.vendor,
       'notes',p.notes,'counted_by',p.counted_by,'updated_at',p.updated_at,'updated_by',p.updated_by) else '{}'::jsonb end;
$$;

-- one stock change: updates on hand and writes the move. Returns the new on hand.
create or replace function public.shop_apply_move(p_part bigint, p_kind text, p_qty numeric, p_extra jsonb, p_by text)
 returns numeric language plpgsql security definer set search_path to 'public'
as $$
declare v_after numeric;
begin
  update shop_parts set on_hand = on_hand + p_qty, updated_at = now(), updated_by = coalesce(p_by, updated_by)
   where id = p_part returning on_hand into v_after;
  if v_after is null then raise exception 'part % not found', p_part; end if;
  insert into shop_stock_moves (part_id, kind, qty, on_hand_after, session_key, wo_number, trailer, tech, po_number, vendor, unit_cost, note, by_name)
  values (p_part, p_kind, p_qty, v_after, p_extra->>'session_key', p_extra->>'wo_number', p_extra->>'trailer', p_extra->>'tech',
          p_extra->>'po_number', p_extra->>'vendor', nullif(p_extra->>'unit_cost','')::numeric, p_extra->>'note', p_by);
  return v_after;
end $$;
revoke all on function public.shop_apply_move(bigint, text, numeric, jsonb, text) from public, anon, authenticated;

-- ---------- tech side ----------
create or replace function public.shop_parts_list()
 returns json language sql stable security definer set search_path to 'public'
as $$
  select json_build_object('ok', true, 'parts', coalesce(json_agg(shop_part_json(p, false) order by p.category nulls last, p.description), '[]'::json))
    from shop_parts p where p.active;
$$;

create or replace function public.shop_session_parts(p_session text)
 returns json language sql stable security definer set search_path to 'public'
as $$
  select json_build_object('ok', true, 'parts', coalesce((select parts from shop_session_parts where session_key = p_session), '[]'::jsonb));
$$;

-- p_parts: [{desc, qty, notes, part_id?}] — the session's whole parts list as the tech saved it.
-- Stock is set so this session's total use of each part matches the list: saving progress twice does not
-- deduct twice, and taking a part off the list puts it back on the shelf.
create or replace function public.shop_use_parts(p_session text, p_wo text, p_trailer text, p_tech text, p_parts jsonb)
 returns json language plpgsql security definer set search_path to 'public'
as $$
declare r record; v_low json;
begin
  if coalesce(trim(p_session),'') = '' or coalesce(trim(p_tech),'') = '' then return json_build_object('ok',false,'error','missing session or tech'); end if;
  if jsonb_typeof(coalesce(p_parts,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_parts,'[]'::jsonb)) > 60 then
    return json_build_object('ok',false,'error','bad parts list'); end if;

  insert into shop_session_parts (session_key, wo_number, trailer, tech, parts, updated_at)
  values (p_session, p_wo, p_trailer, p_tech, coalesce(p_parts,'[]'::jsonb), now())
  on conflict (session_key) do update set parts = excluded.parts, wo_number = excluded.wo_number, trailer = excluded.trailer,
    tech = excluded.tech, updated_at = now();

  for r in
    with want as (
      select (e->>'part_id')::bigint part_id, sum(greatest(0, least(500, coalesce(nullif(regexp_replace(e->>'qty','[^0-9.]','','g'),'')::numeric, 1)))) qty
        from jsonb_array_elements(coalesce(p_parts,'[]'::jsonb)) e
       where coalesce(e->>'part_id','') ~ '^\d+$'
       group by 1),
    have as (
      select part_id, -sum(qty) qty from shop_stock_moves where session_key = p_session and kind = 'use' group by 1)
    select coalesce(w.part_id, h.part_id) part_id, coalesce(w.qty,0) - coalesce(h.qty,0) delta
      from want w full join have h on h.part_id = w.part_id
     where coalesce(w.qty,0) <> coalesce(h.qty,0)
       and exists (select 1 from shop_parts p where p.id = coalesce(w.part_id, h.part_id))
  loop
    perform shop_apply_move(r.part_id, 'use', -r.delta,
      jsonb_build_object('session_key',p_session,'wo_number',p_wo,'trailer',p_trailer,'tech',p_tech,
                         'note', case when r.delta < 0 then 'Taken off the repair (back to stock)' end), p_tech);
  end loop;

  select coalesce(json_agg(json_build_object('description',p.description,'on_hand',p.on_hand)), '[]'::json) into v_low
    from shop_parts p
   where p.id in (select (e->>'part_id')::bigint from jsonb_array_elements(coalesce(p_parts,'[]'::jsonb)) e where coalesce(e->>'part_id','') ~ '^\d+$')
     and p.reorder_point is not null and p.on_hand <= p.reorder_point;
  return json_build_object('ok', true, 'low', v_low);
end $$;

-- ---------- manager side ----------
create or replace function public.shop_inv_list(p_token text)
 returns json language plpgsql stable security definer set search_path to 'public'
as $$
declare v_by text := shop_mgr_name(p_token);
begin
  if v_by is null then return json_build_object('ok',false,'error','signed_out'); end if;
  return json_build_object('ok', true, 'me', v_by,
    'parts', coalesce((select json_agg(shop_part_json(p, true) || jsonb_build_object(
                 'used_90', (select coalesce(-sum(m.qty),0) from shop_stock_moves m where m.part_id = p.id and m.kind = 'use' and m.at > now() - interval '90 days'),
                 'last_move', (select max(m.at) from shop_stock_moves m where m.part_id = p.id))
               order by p.category nulls last, p.description) from shop_parts p), '[]'::json));
end $$;

-- p_part: {id?, part_no, description, category, bin, uom, reorder_point, reorder_qty, unit_cost, vendor, notes, active, on_hand?}
-- on_hand only counts for a new part (it becomes its first count). Change counts with shop_inv_move.
create or replace function public.shop_inv_save_part(p_token text, p_part jsonb)
 returns json language plpgsql security definer set search_path to 'public'
as $$
declare v_by text := shop_mgr_name(p_token); v_id bigint := nullif(p_part->>'id','')::bigint; v_qty numeric;
        v_no text := nullif(trim(p_part->>'part_no'),'');
begin
  if v_by is null then return json_build_object('ok',false,'error','signed_out'); end if;
  if coalesce(trim(p_part->>'description'),'') = '' then return json_build_object('ok',false,'error','Description is required.'); end if;
  if v_no is not null and exists (select 1 from shop_parts where upper(part_no) = upper(v_no) and id is distinct from v_id) then
    return json_build_object('ok',false,'error','Part # '||v_no||' is already on another part.'); end if;
  if v_id is null then
    insert into shop_parts (part_no, description, category, bin, uom, reorder_point, reorder_qty, unit_cost, vendor, notes, active, updated_by)
    values (v_no, trim(p_part->>'description'), nullif(trim(p_part->>'category'),''), nullif(trim(p_part->>'bin'),''),
            coalesce(nullif(trim(p_part->>'uom'),''),'each'), nullif(p_part->>'reorder_point','')::numeric, nullif(p_part->>'reorder_qty','')::numeric,
            nullif(p_part->>'unit_cost','')::numeric, nullif(trim(p_part->>'vendor'),''), nullif(trim(p_part->>'notes'),''),
            coalesce((p_part->>'active')::boolean, true), v_by)
    returning id into v_id;
    v_qty := nullif(p_part->>'on_hand','')::numeric;
    if v_qty is not null then
      perform shop_apply_move(v_id, 'count', v_qty, jsonb_build_object('note','New part'), v_by);
      update shop_parts set counted_at = now(), counted_by = v_by where id = v_id;
    end if;
  else
    update shop_parts set part_no = v_no, description = trim(p_part->>'description'), category = nullif(trim(p_part->>'category'),''),
      bin = nullif(trim(p_part->>'bin'),''), uom = coalesce(nullif(trim(p_part->>'uom'),''),'each'),
      reorder_point = nullif(p_part->>'reorder_point','')::numeric, reorder_qty = nullif(p_part->>'reorder_qty','')::numeric,
      unit_cost = nullif(p_part->>'unit_cost','')::numeric, vendor = nullif(trim(p_part->>'vendor'),''), notes = nullif(trim(p_part->>'notes'),''),
      active = coalesce((p_part->>'active')::boolean, active), updated_at = now(), updated_by = v_by
     where id = v_id;
    if not found then return json_build_object('ok',false,'error','Part not found.'); end if;
  end if;
  return json_build_object('ok', true, 'id', v_id);
end $$;

-- p_kind: receive (qty added), adjust (qty +/-), count (qty = what is on the shelf).
-- p_lines: [{part_id, qty, unit_cost?, note?}]. p_info: {po_number, vendor, note}
create or replace function public.shop_inv_move(p_token text, p_kind text, p_lines jsonb, p_info jsonb default '{}'::jsonb)
 returns json language plpgsql security definer set search_path to 'public'
as $$
declare v_by text := shop_mgr_name(p_token); l jsonb; v_part bigint; v_qty numeric; v_cur numeric; v_n int := 0; v_cost numeric;
begin
  if v_by is null then return json_build_object('ok',false,'error','signed_out'); end if;
  if p_kind not in ('receive','adjust','count') then return json_build_object('ok',false,'error','bad kind'); end if;
  for l in select * from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) loop
    v_part := nullif(l->>'part_id','')::bigint; v_qty := nullif(l->>'qty','')::numeric;
    continue when v_part is null or v_qty is null;
    select on_hand into v_cur from shop_parts where id = v_part for update;
    continue when not found;
    v_cost := nullif(l->>'unit_cost','')::numeric;
    if p_kind = 'receive' then
      if v_qty <= 0 then continue; end if;
      perform shop_apply_move(v_part, 'receive', v_qty, jsonb_build_object('po_number',p_info->>'po_number','vendor',p_info->>'vendor',
        'unit_cost',v_cost,'note',coalesce(l->>'note',p_info->>'note')), v_by);
      update shop_parts set unit_cost = coalesce(v_cost, unit_cost), vendor = coalesce(nullif(trim(p_info->>'vendor'),''), vendor) where id = v_part;
    elsif p_kind = 'adjust' then
      if v_qty = 0 then continue; end if;
      perform shop_apply_move(v_part, 'adjust', v_qty, jsonb_build_object('note',coalesce(l->>'note',p_info->>'note')), v_by);
    else
      if v_qty < 0 then continue; end if;
      perform shop_apply_move(v_part, 'count', v_qty - v_cur, jsonb_build_object('note',coalesce(l->>'note',p_info->>'note')), v_by);
      update shop_parts set counted_at = now(), counted_by = v_by where id = v_part;
    end if;
    v_n := v_n + 1;
  end loop;
  return json_build_object('ok', true, 'lines', v_n);
end $$;

-- Moves for one part (p_part) or all parts, last p_days days.
create or replace function public.shop_inv_history(p_token text, p_part bigint default null, p_days int default 90)
 returns json language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if shop_mgr_name(p_token) is null then return json_build_object('ok',false,'error','signed_out'); end if;
  return json_build_object('ok', true, 'moves', coalesce((
    select json_agg(json_build_object('id',m.id,'at',m.at,'kind',m.kind,'qty',m.qty,'on_hand_after',m.on_hand_after,'part_id',m.part_id,
      'part_no',p.part_no,'description',p.description,'category',p.category,'unit_cost',coalesce(m.unit_cost,p.unit_cost),
      'wo_number',m.wo_number,'trailer',m.trailer,'tech',m.tech,'po_number',m.po_number,'vendor',m.vendor,'note',m.note,'by',m.by_name) order by m.at desc, m.id desc)
      from (select * from shop_stock_moves
             where (p_part is null or part_id = p_part) and at > now() - make_interval(days => greatest(1, least(coalesce(p_days,90), 1100)))
             order by at desc limit 3000) m
      join shop_parts p on p.id = m.part_id), '[]'::json));
end $$;

-- p_rows: [{part_no, description, category, bin, uom, qty, unit_cost, reorder_point, vendor}]
-- Matches an existing part by part #, then by description. p_counts = true: qty is a real count (sets on hand).
-- false: names only, counts stay "not counted" (use for an old list nobody trusts).
create or replace function public.shop_inv_import(p_token text, p_rows jsonb, p_counts boolean default false)
 returns json language plpgsql security definer set search_path to 'public'
as $$
declare v_by text := shop_mgr_name(p_token); r jsonb; v_id bigint; v_no text; v_desc text; v_qty numeric; v_cur numeric;
        v_new int := 0; v_upd int := 0; v_cnt int := 0; v_skip int := 0;
begin
  if v_by is null then return json_build_object('ok',false,'error','signed_out'); end if;
  if jsonb_array_length(coalesce(p_rows,'[]'::jsonb)) > 3000 then return json_build_object('ok',false,'error','Too many rows (3,000 max).'); end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    v_no := nullif(trim(r->>'part_no'),''); v_desc := nullif(trim(r->>'description'),'');
    if v_desc is null and v_no is null then v_skip := v_skip + 1; continue; end if;
    v_id := null;
    if v_no is not null then select id into v_id from shop_parts where upper(part_no) = upper(v_no); end if;
    if v_id is null and v_desc is not null then select id into v_id from shop_parts where lower(description) = lower(v_desc) order by id limit 1; end if;
    if v_id is null then
      insert into shop_parts (part_no, description, category, bin, uom, reorder_point, unit_cost, vendor, updated_by)
      values (v_no, coalesce(v_desc, v_no), nullif(trim(r->>'category'),''), nullif(trim(r->>'bin'),''), coalesce(nullif(trim(r->>'uom'),''),'each'),
              nullif(r->>'reorder_point','')::numeric, nullif(r->>'unit_cost','')::numeric, nullif(trim(r->>'vendor'),''), v_by)
      returning id into v_id;
      v_new := v_new + 1;
    else
      update shop_parts set part_no = coalesce(part_no, v_no), category = coalesce(nullif(trim(r->>'category'),''), category),
        bin = coalesce(nullif(trim(r->>'bin'),''), bin), uom = coalesce(nullif(trim(r->>'uom'),''), uom),
        reorder_point = coalesce(nullif(r->>'reorder_point','')::numeric, reorder_point), unit_cost = coalesce(nullif(r->>'unit_cost','')::numeric, unit_cost),
        vendor = coalesce(nullif(trim(r->>'vendor'),''), vendor), active = true, updated_at = now(), updated_by = v_by
       where id = v_id;
      v_upd := v_upd + 1;
    end if;
    v_qty := nullif(regexp_replace(coalesce(r->>'qty',''),'[^0-9.\-]','','g'),'')::numeric;
    if p_counts and v_qty is not null and v_qty >= 0 then
      select on_hand into v_cur from shop_parts where id = v_id;
      perform shop_apply_move(v_id, 'import', v_qty - v_cur, jsonb_build_object('note','Imported count'), v_by);
      update shop_parts set counted_at = now(), counted_by = v_by where id = v_id;
      v_cnt := v_cnt + 1;
    end if;
  end loop;
  return json_build_object('ok', true, 'added', v_new, 'updated', v_upd, 'counted', v_cnt, 'skipped', v_skip);
end $$;

grant execute on function public.shop_parts_list(), public.shop_session_parts(text), public.shop_use_parts(text,text,text,text,jsonb),
  public.shop_inv_list(text), public.shop_inv_save_part(text,jsonb), public.shop_inv_move(text,text,jsonb,jsonb),
  public.shop_inv_history(text,bigint,int), public.shop_inv_import(text,jsonb,boolean) to anon, authenticated;
revoke all on function public.shop_mgr_name(text) from public, anon, authenticated;

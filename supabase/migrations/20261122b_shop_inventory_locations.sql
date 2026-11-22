-- Shop Inventory v2: stock kept at two places (Transportation Manager v2.9.0 / Trailer Shop v1.4.0)
--   SHOP    = Trailer Shop
--   OFFSITE = Off-Site Shop (the portable building on the customer trailer yard)
-- Rebuilds the v1 tables (they were still empty when this ran). Locations live in shop_locations, so a
-- third one later is one insert.
--
-- shop_parts  = what the part is (name, part #, category, cost, vendor)
-- shop_stock  = how many are at each location (on hand, bin, reorder point, last counted)
-- shop_stock_moves = every change, with its location. A transfer between locations writes two moves.

drop function if exists public.shop_parts_list();
drop function if exists public.shop_session_parts(text);
drop function if exists public.shop_use_parts(text,text,text,text,jsonb);
drop function if exists public.shop_inv_list(text);
drop function if exists public.shop_inv_save_part(text,jsonb);
drop function if exists public.shop_inv_move(text,text,jsonb,jsonb);
drop function if exists public.shop_inv_history(text,bigint,int);
drop function if exists public.shop_inv_import(text,jsonb,boolean);
drop function if exists public.shop_apply_move(bigint,text,numeric,jsonb,text);
drop function if exists public.shop_part_json(public.shop_parts,boolean);
drop table if exists public.shop_stock_moves;
drop table if exists public.shop_session_parts;
drop table if exists public.shop_parts;

create table public.shop_locations (
  code text primary key,
  name text not null,
  short_name text not null,
  sort int not null default 0,
  active boolean not null default true
);
insert into public.shop_locations (code, name, short_name, sort) values
  ('SHOP', 'Trailer Shop', 'Shop', 1),
  ('OFFSITE', 'Off-Site Shop', 'Off-Site', 2);
alter table public.shop_locations enable row level security;

create table public.shop_parts (
  id            bigserial primary key,
  part_no       text,
  description   text not null,
  category      text,
  uom           text not null default 'each',
  reorder_qty   numeric,
  unit_cost     numeric,
  vendor        text,
  notes         text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    text
);
create unique index shop_parts_part_no_uq on public.shop_parts (upper(part_no)) where part_no is not null and part_no <> '';
create index shop_parts_desc_ix on public.shop_parts (lower(description));
alter table public.shop_parts enable row level security;

create table public.shop_stock (
  part_id       bigint not null references public.shop_parts(id) on delete cascade,
  location      text not null references public.shop_locations(code),
  on_hand       numeric not null default 0,
  bin           text,
  reorder_point numeric,
  counted_at    timestamptz,     -- null = never physically counted here
  counted_by    text,
  primary key (part_id, location)
);
alter table public.shop_stock enable row level security;

create table public.shop_stock_moves (
  id            bigserial primary key,
  part_id       bigint not null references public.shop_parts(id),
  location      text not null references public.shop_locations(code),
  at            timestamptz not null default now(),
  kind          text not null check (kind in ('receive','use','adjust','count','import','transfer')),
  qty           numeric not null,     -- signed change at this location
  on_hand_after numeric not null,
  session_key   text,
  wo_number     text,
  trailer       text,
  tech          text,
  po_number     text,
  vendor        text,
  unit_cost     numeric,
  note          text,
  by_name       text
);
create index shop_moves_part_ix on public.shop_stock_moves (part_id, at desc);
create index shop_moves_at_ix on public.shop_stock_moves (at desc);
create index shop_moves_session_ix on public.shop_stock_moves (session_key) where session_key is not null;
alter table public.shop_stock_moves enable row level security;

create table public.shop_session_parts (
  session_key text primary key,
  wo_number   text,
  trailer     text,
  tech        text,
  parts       jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);
alter table public.shop_session_parts enable row level security;

-- ---------- helpers ----------
create or replace function public.shop_loc(p text)
 returns text language sql stable security definer set search_path to 'public'
as $$ select coalesce((select code from shop_locations where code = upper(trim(coalesce(p,'')))), 'SHOP'); $$;

create or replace function public.shop_locations_json()
 returns json language sql stable security definer set search_path to 'public'
as $$ select coalesce(json_agg(json_build_object('code',code,'name',name,'short',short_name) order by sort), '[]'::json) from shop_locations where active; $$;

-- stock rows for one part
create or replace function public.shop_stock_json(p_part bigint)
 returns json language sql stable security definer set search_path to 'public'
as $$
  select coalesce(json_agg(json_build_object('loc',s.location,'on_hand',s.on_hand,'bin',s.bin,'reorder_point',s.reorder_point,
    'counted_at',s.counted_at,'counted_by',s.counted_by,'low', s.reorder_point is not null and s.on_hand <= s.reorder_point) order by l.sort), '[]'::json)
    from shop_stock s join shop_locations l on l.code = s.location where s.part_id = p_part;
$$;

create or replace function public.shop_apply_move(p_part bigint, p_loc text, p_kind text, p_qty numeric, p_extra jsonb, p_by text)
 returns numeric language plpgsql security definer set search_path to 'public'
as $$
declare v_after numeric;
begin
  insert into shop_stock (part_id, location) values (p_part, p_loc) on conflict do nothing;
  update shop_stock set on_hand = on_hand + p_qty where part_id = p_part and location = p_loc returning on_hand into v_after;
  update shop_parts set updated_at = now(), updated_by = coalesce(p_by, updated_by) where id = p_part;
  insert into shop_stock_moves (part_id, location, kind, qty, on_hand_after, session_key, wo_number, trailer, tech, po_number, vendor, unit_cost, note, by_name)
  values (p_part, p_loc, p_kind, p_qty, v_after, p_extra->>'session_key', p_extra->>'wo_number', p_extra->>'trailer', p_extra->>'tech',
          p_extra->>'po_number', p_extra->>'vendor', nullif(p_extra->>'unit_cost','')::numeric, p_extra->>'note', p_by);
  return v_after;
end $$;

-- ---------- tech side (Trailer Shop app) ----------
create or replace function public.shop_parts_list()
 returns json language sql stable security definer set search_path to 'public'
as $$
  select json_build_object('ok', true, 'locations', shop_locations_json(), 'parts', coalesce(json_agg(json_build_object(
      'id',p.id,'part_no',p.part_no,'description',p.description,'category',p.category,'uom',p.uom,'stock',shop_stock_json(p.id))
      order by p.category nulls last, p.description), '[]'::json))
    from shop_parts p where p.active;
$$;

create or replace function public.shop_session_parts(p_session text)
 returns json language sql stable security definer set search_path to 'public'
as $$
  select json_build_object('ok', true, 'parts', coalesce((select parts from shop_session_parts where session_key = p_session), '[]'::jsonb));
$$;

-- p_parts: [{desc, qty, notes, part_id?, loc?}] — the session's whole parts list as the tech saved it.
-- Sets this session's total use of each part at each location to match the list.
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
      select (e->>'part_id')::bigint part_id, shop_loc(e->>'loc') loc,
             sum(greatest(0, least(500, coalesce(nullif(regexp_replace(e->>'qty','[^0-9.]','','g'),'')::numeric, 1)))) qty
        from jsonb_array_elements(coalesce(p_parts,'[]'::jsonb)) e
       where coalesce(e->>'part_id','') ~ '^\d+$'
       group by 1, 2),
    have as (
      select part_id, location loc, -sum(qty) qty from shop_stock_moves where session_key = p_session and kind = 'use' group by 1, 2)
    select coalesce(w.part_id, h.part_id) part_id, coalesce(w.loc, h.loc) loc, coalesce(w.qty,0) - coalesce(h.qty,0) delta
      from want w full join have h on h.part_id = w.part_id and h.loc = w.loc
     where coalesce(w.qty,0) <> coalesce(h.qty,0)
       and exists (select 1 from shop_parts p where p.id = coalesce(w.part_id, h.part_id))
  loop
    perform shop_apply_move(r.part_id, r.loc, 'use', -r.delta,
      jsonb_build_object('session_key',p_session,'wo_number',p_wo,'trailer',p_trailer,'tech',p_tech,
                         'note', case when r.delta < 0 then 'Taken off the repair (back to stock)' end), p_tech);
  end loop;

  select coalesce(json_agg(json_build_object('description',p.description,'loc',l.name,'on_hand',s.on_hand)), '[]'::json) into v_low
    from shop_stock s join shop_parts p on p.id = s.part_id join shop_locations l on l.code = s.location
   where (s.part_id, s.location) in (select (e->>'part_id')::bigint, shop_loc(e->>'loc') from jsonb_array_elements(coalesce(p_parts,'[]'::jsonb)) e
                                      where coalesce(e->>'part_id','') ~ '^\d+$')
     and s.reorder_point is not null and s.on_hand <= s.reorder_point;
  return json_build_object('ok', true, 'low', v_low);
end $$;

-- ---------- manager side (Transportation Manager) ----------
create or replace function public.shop_inv_list(p_token text)
 returns json language plpgsql stable security definer set search_path to 'public'
as $$
declare v_by text := shop_mgr_name(p_token);
begin
  if v_by is null then return json_build_object('ok',false,'error','signed_out'); end if;
  return json_build_object('ok', true, 'me', v_by, 'locations', shop_locations_json(),
    'parts', coalesce((select json_agg(json_build_object('id',p.id,'part_no',p.part_no,'description',p.description,'category',p.category,
                 'uom',p.uom,'reorder_qty',p.reorder_qty,'unit_cost',p.unit_cost,'vendor',p.vendor,'notes',p.notes,'active',p.active,
                 'updated_at',p.updated_at,'updated_by',p.updated_by,'stock',shop_stock_json(p.id),
                 'used_90', (select coalesce(-sum(m.qty),0) from shop_stock_moves m where m.part_id = p.id and m.kind = 'use' and m.at > now() - interval '90 days'))
               order by p.category nulls last, p.description) from shop_parts p), '[]'::json));
end $$;

-- p_part: {id?, part_no, description, category, uom, reorder_qty, unit_cost, vendor, notes, active,
--          stock: [{loc, kept (bool), bin, reorder_point, on_hand (new rows only: first count)}]}
-- kept=false removes a location only when nothing is on hand there.
create or replace function public.shop_inv_save_part(p_token text, p_part jsonb)
 returns json language plpgsql security definer set search_path to 'public'
as $$
declare v_by text := shop_mgr_name(p_token); v_id bigint := nullif(p_part->>'id','')::bigint; s jsonb; v_loc text; v_qty numeric; v_new boolean;
        v_no text := nullif(trim(p_part->>'part_no'),'');
begin
  if v_by is null then return json_build_object('ok',false,'error','signed_out'); end if;
  if coalesce(trim(p_part->>'description'),'') = '' then return json_build_object('ok',false,'error','Description is required.'); end if;
  if v_no is not null and exists (select 1 from shop_parts where upper(part_no) = upper(v_no) and id is distinct from v_id) then
    return json_build_object('ok',false,'error','Part # '||v_no||' is already on another part.'); end if;
  if v_id is null then
    insert into shop_parts (part_no, description, category, uom, reorder_qty, unit_cost, vendor, notes, active, updated_by)
    values (v_no, trim(p_part->>'description'), nullif(trim(p_part->>'category'),''), coalesce(nullif(trim(p_part->>'uom'),''),'each'),
            nullif(p_part->>'reorder_qty','')::numeric, nullif(p_part->>'unit_cost','')::numeric, nullif(trim(p_part->>'vendor'),''),
            nullif(trim(p_part->>'notes'),''), coalesce((p_part->>'active')::boolean, true), v_by)
    returning id into v_id;
  else
    update shop_parts set part_no = v_no, description = trim(p_part->>'description'), category = nullif(trim(p_part->>'category'),''),
      uom = coalesce(nullif(trim(p_part->>'uom'),''),'each'), reorder_qty = nullif(p_part->>'reorder_qty','')::numeric,
      unit_cost = nullif(p_part->>'unit_cost','')::numeric, vendor = nullif(trim(p_part->>'vendor'),''), notes = nullif(trim(p_part->>'notes'),''),
      active = coalesce((p_part->>'active')::boolean, active), updated_at = now(), updated_by = v_by
     where id = v_id;
    if not found then return json_build_object('ok',false,'error','Part not found.'); end if;
  end if;
  for s in select * from jsonb_array_elements(coalesce(p_part->'stock','[]'::jsonb)) loop
    v_loc := shop_loc(s->>'loc');
    if coalesce((s->>'kept')::boolean, true) then
      v_new := not exists (select 1 from shop_stock where part_id = v_id and location = v_loc);
      insert into shop_stock (part_id, location) values (v_id, v_loc) on conflict do nothing;
      update shop_stock set bin = nullif(trim(s->>'bin'),''), reorder_point = nullif(s->>'reorder_point','')::numeric
       where part_id = v_id and location = v_loc;
      v_qty := nullif(s->>'on_hand','')::numeric;
      if v_new and v_qty is not null and v_qty >= 0 then
        perform shop_apply_move(v_id, v_loc, 'count', v_qty, jsonb_build_object('note','New part'), v_by);
        update shop_stock set counted_at = now(), counted_by = v_by where part_id = v_id and location = v_loc;
      end if;
    else
      delete from shop_stock where part_id = v_id and location = v_loc and on_hand = 0;
    end if;
  end loop;
  return json_build_object('ok', true, 'id', v_id);
end $$;

-- p_kind: receive (qty added), adjust (qty +/-), count (qty = what is on the shelf), transfer (qty moved from loc to to_loc).
-- p_lines: [{part_id, loc, to_loc?, qty, unit_cost?, note?}]. p_info: {po_number, vendor, note, loc (default for lines)}
create or replace function public.shop_inv_move(p_token text, p_kind text, p_lines jsonb, p_info jsonb default '{}'::jsonb)
 returns json language plpgsql security definer set search_path to 'public'
as $$
declare v_by text := shop_mgr_name(p_token); l jsonb; v_part bigint; v_qty numeric; v_cur numeric; v_n int := 0; v_cost numeric;
        v_loc text; v_to text; v_note text;
begin
  if v_by is null then return json_build_object('ok',false,'error','signed_out'); end if;
  if p_kind not in ('receive','adjust','count','transfer') then return json_build_object('ok',false,'error','bad kind'); end if;
  for l in select * from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) loop
    v_part := nullif(l->>'part_id','')::bigint; v_qty := nullif(l->>'qty','')::numeric;
    continue when v_part is null or v_qty is null or not exists (select 1 from shop_parts where id = v_part);
    v_loc := shop_loc(coalesce(l->>'loc', p_info->>'loc'));
    v_cost := nullif(l->>'unit_cost','')::numeric;
    v_note := coalesce(nullif(l->>'note',''), nullif(p_info->>'note',''));
    if p_kind = 'receive' then
      if v_qty <= 0 then continue; end if;
      perform shop_apply_move(v_part, v_loc, 'receive', v_qty, jsonb_build_object('po_number',p_info->>'po_number','vendor',p_info->>'vendor',
        'unit_cost',v_cost,'note',v_note), v_by);
      update shop_parts set unit_cost = coalesce(v_cost, unit_cost), vendor = coalesce(nullif(trim(p_info->>'vendor'),''), vendor) where id = v_part;
    elsif p_kind = 'adjust' then
      if v_qty = 0 then continue; end if;
      perform shop_apply_move(v_part, v_loc, 'adjust', v_qty, jsonb_build_object('note',v_note), v_by);
    elsif p_kind = 'transfer' then
      v_to := shop_loc(l->>'to_loc');
      if v_qty <= 0 or v_to = v_loc then continue; end if;
      perform shop_apply_move(v_part, v_loc, 'transfer', -v_qty, jsonb_build_object('note',coalesce(v_note,'')||case when v_note is null then '' else ' · ' end||'To '||(select name from shop_locations where code=v_to)), v_by);
      perform shop_apply_move(v_part, v_to, 'transfer', v_qty, jsonb_build_object('note',coalesce(v_note,'')||case when v_note is null then '' else ' · ' end||'From '||(select name from shop_locations where code=v_loc)), v_by);
    else
      if v_qty < 0 then continue; end if;
      insert into shop_stock (part_id, location) values (v_part, v_loc) on conflict do nothing;
      select on_hand into v_cur from shop_stock where part_id = v_part and location = v_loc for update;
      perform shop_apply_move(v_part, v_loc, 'count', v_qty - v_cur, jsonb_build_object('note',v_note), v_by);
      update shop_stock set counted_at = now(), counted_by = v_by where part_id = v_part and location = v_loc;
    end if;
    v_n := v_n + 1;
  end loop;
  return json_build_object('ok', true, 'lines', v_n);
end $$;

create or replace function public.shop_inv_history(p_token text, p_part bigint default null, p_days int default 90)
 returns json language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if shop_mgr_name(p_token) is null then return json_build_object('ok',false,'error','signed_out'); end if;
  return json_build_object('ok', true, 'moves', coalesce((
    select json_agg(json_build_object('id',m.id,'at',m.at,'kind',m.kind,'qty',m.qty,'on_hand_after',m.on_hand_after,'part_id',m.part_id,
      'loc',m.location,'part_no',p.part_no,'description',p.description,'category',p.category,'unit_cost',coalesce(m.unit_cost,p.unit_cost),
      'wo_number',m.wo_number,'trailer',m.trailer,'tech',m.tech,'po_number',m.po_number,'vendor',m.vendor,'note',m.note,'by',m.by_name) order by m.at desc, m.id desc)
      from (select * from shop_stock_moves
             where (p_part is null or part_id = p_part) and at > now() - make_interval(days => greatest(1, least(coalesce(p_days,90), 1100)))
             order by at desc limit 3000) m
      join shop_parts p on p.id = m.part_id), '[]'::json));
end $$;

-- p_rows: [{part_no, description, category, loc, bin, uom, qty, unit_cost, reorder_point, vendor}]; p_loc = location for rows without one.
create or replace function public.shop_inv_import(p_token text, p_rows jsonb, p_counts boolean default false, p_loc text default 'SHOP')
 returns json language plpgsql security definer set search_path to 'public'
as $$
declare v_by text := shop_mgr_name(p_token); r jsonb; v_id bigint; v_no text; v_desc text; v_qty numeric; v_cur numeric; v_loc text;
        v_new int := 0; v_upd int := 0; v_cnt int := 0; v_skip int := 0;
begin
  if v_by is null then return json_build_object('ok',false,'error','signed_out'); end if;
  if jsonb_array_length(coalesce(p_rows,'[]'::jsonb)) > 3000 then return json_build_object('ok',false,'error','Too many rows (3,000 max).'); end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    v_no := nullif(trim(r->>'part_no'),''); v_desc := nullif(trim(r->>'description'),'');
    if v_desc is null and v_no is null then v_skip := v_skip + 1; continue; end if;
    v_loc := shop_loc(coalesce(nullif(r->>'loc',''), p_loc));
    v_id := null;
    if v_no is not null then select id into v_id from shop_parts where upper(part_no) = upper(v_no); end if;
    if v_id is null and v_desc is not null then select id into v_id from shop_parts where lower(description) = lower(v_desc) order by id limit 1; end if;
    if v_id is null then
      insert into shop_parts (part_no, description, category, uom, unit_cost, vendor, updated_by)
      values (v_no, coalesce(v_desc, v_no), nullif(trim(r->>'category'),''), coalesce(nullif(trim(r->>'uom'),''),'each'),
              nullif(r->>'unit_cost','')::numeric, nullif(trim(r->>'vendor'),''), v_by)
      returning id into v_id;
      v_new := v_new + 1;
    else
      update shop_parts set part_no = coalesce(part_no, v_no), category = coalesce(nullif(trim(r->>'category'),''), category),
        uom = coalesce(nullif(trim(r->>'uom'),''), uom), unit_cost = coalesce(nullif(r->>'unit_cost','')::numeric, unit_cost),
        vendor = coalesce(nullif(trim(r->>'vendor'),''), vendor), active = true, updated_at = now(), updated_by = v_by
       where id = v_id;
      v_upd := v_upd + 1;
    end if;
    insert into shop_stock (part_id, location) values (v_id, v_loc) on conflict do nothing;
    update shop_stock set bin = coalesce(nullif(trim(r->>'bin'),''), bin), reorder_point = coalesce(nullif(r->>'reorder_point','')::numeric, reorder_point)
     where part_id = v_id and location = v_loc;
    v_qty := nullif(regexp_replace(coalesce(r->>'qty',''),'[^0-9.\-]','','g'),'')::numeric;
    if p_counts and v_qty is not null and v_qty >= 0 then
      select on_hand into v_cur from shop_stock where part_id = v_id and location = v_loc;
      perform shop_apply_move(v_id, v_loc, 'import', v_qty - v_cur, jsonb_build_object('note','Imported count'), v_by);
      update shop_stock set counted_at = now(), counted_by = v_by where part_id = v_id and location = v_loc;
      v_cnt := v_cnt + 1;
    end if;
  end loop;
  return json_build_object('ok', true, 'added', v_new, 'updated', v_upd, 'counted', v_cnt, 'skipped', v_skip);
end $$;

revoke all on function public.shop_apply_move(bigint, text, text, numeric, jsonb, text) from public, anon, authenticated;
revoke all on function public.shop_stock_json(bigint) from public, anon, authenticated;
grant execute on function public.shop_parts_list(), public.shop_session_parts(text), public.shop_use_parts(text,text,text,text,jsonb),
  public.shop_inv_list(text), public.shop_inv_save_part(text,jsonb), public.shop_inv_move(text,text,jsonb,jsonb),
  public.shop_inv_history(text,bigint,int), public.shop_inv_import(text,jsonb,boolean,text) to anon, authenticated;

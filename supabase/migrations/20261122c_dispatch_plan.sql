-- Dispatch weekly plan (Transportation Manager v2.9.0 > Dispatch Board > Weekly Plan)
-- Fed by the Dispatch Extract Apps Script (gas/DispatchExtract.gs): after it builds Dispatch_Extract it
-- reads the dispatcher workbook's weekly tabs ("11-23-26") and replaces everything here.
-- The sync key's sha256 goes in dispatch_plan_sync (set once by hand, not in this file).
-- One row per sheet row per day. Sheet rows with no plans that week are kept (day = null) so the
-- whole roster shows, in sheet order.

create table if not exists public.dispatch_plan (
  id         bigserial primary key,
  tab        text not null,         -- weekly tab name, e.g. 11-23-26
  week_start date not null,         -- first day in the tab's header
  week_end   date not null,         -- last day in the tab's header
  row_no     int not null,          -- sheet row (keeps the dispatcher's order)
  section    text,                  -- e.g. BULLPEN for loads not on a driver yet
  grp        text,                  -- column A (Position / group)
  truck      text,                  -- column B
  driver     text,                  -- column C
  day        date,                  -- null = roster row with nothing planned this week
  assignment text,
  notes      text
);
create index if not exists dispatch_plan_tab_ix on public.dispatch_plan (tab, row_no);
create index if not exists dispatch_plan_week_ix on public.dispatch_plan (week_start, week_end);
alter table public.dispatch_plan enable row level security;

create table if not exists public.dispatch_plan_sync (
  id        int primary key default 1 check (id = 1),
  key_hash  text not null,          -- sha256 of the Apps Script's DISPATCH_SYNC_KEY
  synced_at timestamptz,
  tabs      int,
  cells     int,
  source    text
);
alter table public.dispatch_plan_sync enable row level security;

-- Apps Script -> Supabase. p_tabs: [{tab, week_start, week_end, rows:[{row_no, section, grp, truck, driver, days:[{date, a, n}]}]}]
create or replace function public.dispatch_plan_push(p_key text, p_tabs jsonb, p_source text default null)
 returns json language plpgsql security definer set search_path to 'public', 'extensions'
as $$
declare v_cells int;
begin
  if not exists (select 1 from dispatch_plan_sync where id = 1 and key_hash = encode(extensions.digest(coalesce(p_key,''), 'sha256'), 'hex')) then
    return json_build_object('ok', false, 'error', 'bad key');
  end if;
  if jsonb_typeof(p_tabs) <> 'array' or jsonb_array_length(p_tabs) = 0 then
    return json_build_object('ok', false, 'error', 'no weekly tabs');
  end if;
  delete from dispatch_plan where true;
  insert into dispatch_plan (tab, week_start, week_end, row_no, section, grp, truck, driver, day, assignment, notes)
  select t->>'tab', (t->>'week_start')::date, (t->>'week_end')::date, (r->>'row_no')::int,
         nullif(trim(r->>'section'),''), nullif(trim(r->>'grp'),''), nullif(trim(r->>'truck'),''), nullif(trim(r->>'driver'),''),
         (d->>'date')::date, nullif(trim(d->>'a'),''), nullif(trim(d->>'n'),'')
    from jsonb_array_elements(p_tabs) t
    cross join jsonb_array_elements(t->'rows') r
    cross join lateral jsonb_array_elements(case when jsonb_array_length(coalesce(r->'days','[]'::jsonb)) > 0 then r->'days' else '[{}]'::jsonb end) d
   where coalesce(t->>'week_start','') <> '';
  get diagnostics v_cells = row_count;
  update dispatch_plan_sync set synced_at = now(), tabs = jsonb_array_length(p_tabs), cells = v_cells, source = p_source where id = 1;
  return json_build_object('ok', true, 'tabs', jsonb_array_length(p_tabs), 'cells', v_cells);
end $$;

-- Transportation Manager: one week. p_tab null = the week containing today (else the next one coming, else the latest).
create or replace function public.dispatch_plan_week(p_token text, p_tab text default null)
 returns json language plpgsql stable security definer set search_path to 'public'
as $$
declare v_tab text; v_today date := (now() at time zone 'America/Chicago')::date;
begin
  if drv_session_manager(p_token) is null then return json_build_object('ok', false, 'error', 'signed_out'); end if;
  v_tab := coalesce(
    (select tab from dispatch_plan where tab = p_tab limit 1),
    (select tab from dispatch_plan where v_today between week_start and week_end order by week_start desc limit 1),
    (select tab from dispatch_plan where week_start > v_today order by week_start limit 1),
    (select tab from dispatch_plan order by week_start desc limit 1));
  return json_build_object('ok', true, 'tab', v_tab, 'today', v_today,
    'synced_at', (select synced_at from dispatch_plan_sync where id = 1),
    'weeks', coalesce((select json_agg(json_build_object('tab', tab, 'start', ws, 'end', we) order by ws)
                         from (select tab, min(week_start) ws, max(week_end) we from dispatch_plan group by tab) w), '[]'::json),
    'rows', coalesce((select json_agg(json_build_object('row_no', row_no, 'section', section, 'grp', grp, 'truck', truck, 'driver', driver,
                         'day', day, 'a', assignment, 'n', notes, 'start', week_start, 'end', week_end) order by row_no, day nulls first)
                       from dispatch_plan where tab = v_tab), '[]'::json));
end $$;

revoke all on function public.dispatch_plan_push(text, jsonb, text) from public;
grant execute on function public.dispatch_plan_push(text, jsonb, text), public.dispatch_plan_week(text, text) to anon, authenticated;

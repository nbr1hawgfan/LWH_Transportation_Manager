-- Weekly Plan absence check (Transportation Manager v2.10.0)
-- The dispatch sheet uses short names ("Vincent R.", "Paul"); the PTO & Absence Tracker uses full names and IDs
-- ("REED01 Vincent E. Reed", "BAY01 Albert Bay"). Most match automatically in the app; this table holds the
-- ones a manager linked by hand (or corrected). Keyed by the sheet name, lowercased and trimmed.

create table if not exists public.dispatch_name_map (
  sheet_name text primary key,
  emp_id     text,            -- null = "not in the absence tracker" (stop asking)
  emp_name   text,
  set_by     text,
  set_at     timestamptz not null default now()
);
alter table public.dispatch_name_map enable row level security;

create or replace function public.dispatch_name_map_set(p_token text, p_sheet_name text, p_emp_id text, p_emp_name text, p_clear boolean default false)
 returns json language plpgsql security definer set search_path to 'public'
as $$
declare v_by text := shop_mgr_name(p_token); v_key text := lower(regexp_replace(trim(coalesce(p_sheet_name,'')), '\s+', ' ', 'g'));
begin
  if v_by is null then return json_build_object('ok', false, 'error', 'signed_out'); end if;
  if v_key = '' then return json_build_object('ok', false, 'error', 'no name'); end if;
  if p_clear then delete from dispatch_name_map where sheet_name = v_key; return json_build_object('ok', true); end if;
  insert into dispatch_name_map (sheet_name, emp_id, emp_name, set_by, set_at)
  values (v_key, nullif(trim(p_emp_id),''), nullif(trim(p_emp_name),''), v_by, now())
  on conflict (sheet_name) do update set emp_id = excluded.emp_id, emp_name = excluded.emp_name, set_by = excluded.set_by, set_at = now();
  return json_build_object('ok', true);
end $$;

-- dispatch_plan_week now also returns the name links
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
    'names', coalesce((select json_object_agg(sheet_name, json_build_object('emp_id', emp_id, 'emp_name', emp_name, 'by', set_by)) from dispatch_name_map), '{}'::json),
    'rows', coalesce((select json_agg(json_build_object('row_no', row_no, 'section', section, 'grp', grp, 'truck', truck, 'driver', driver,
                         'day', day, 'a', assignment, 'n', notes, 'start', week_start, 'end', week_end) order by row_no, day nulls first)
                       from dispatch_plan where tab = v_tab), '[]'::json));
end $$;

grant execute on function public.dispatch_name_map_set(text, text, text, text, boolean) to anon, authenticated;

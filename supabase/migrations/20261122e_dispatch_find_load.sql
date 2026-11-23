-- Dispatch Board: find a load # on the weekly plan (Transportation Manager v2.11.0)
-- Searches every synced week (the Apps Script sends the last 10). p_q is the load # or part of it (4+ digits).
create or replace function public.dispatch_find_load(p_token text, p_q text)
 returns json language plpgsql stable security definer set search_path to 'public'
as $$
declare v_q text := regexp_replace(coalesce(p_q,''), '\D', '', 'g');
begin
  if drv_session_manager(p_token) is null then return json_build_object('ok', false, 'error', 'signed_out'); end if;
  if length(v_q) < 4 then return json_build_object('ok', false, 'error', 'Type at least 4 digits of the load #.'); end if;
  return json_build_object('ok', true, 'q', v_q, 'hits', coalesce((
    select json_agg(json_build_object('tab', tab, 'day', day, 'section', section, 'grp', grp, 'truck', truck, 'driver', driver,
                                      'a', assignment, 'n', notes) order by day desc, row_no)
      from (select * from dispatch_plan where day is not null and (assignment like '%' || v_q || '%' or notes like '%' || v_q || '%')
             order by day desc, row_no limit 40) x), '[]'::json));
end $$;
grant execute on function public.dispatch_find_load(text, text) to anon, authenticated;

-- Lets an invite link check its room before anyone signs in (or becomes a
-- guest), so a dead link says why instead of failing at "Join party".
-- Returns 'open' (in the lobby, joinable), 'playing', 'finished', or null
-- when there's no such room — nothing else about the party.
create or replace function public.room_status(p_room_code text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case status when 'lobby' then 'open' else status end
  from public.parties
  where room_code = upper(p_room_code);
$$;

revoke all on function public.room_status(text) from public;
grant execute on function public.room_status(text) to anon, authenticated;

-- Lets a player change their own display name/avatar while sitting in a
-- lobby (typo fixes, or just changing their mind) — previously the only
-- chance to set it was the one-time join step, with no way back.
create or replace function public.update_my_player_identity(p_party_id uuid, p_display_name text, p_avatar text)
returns public.players
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.players;
begin
  if length(trim(p_display_name)) = 0 then
    raise exception 'Name cannot be empty';
  end if;

  update public.players
  set display_name = trim(p_display_name), avatar = p_avatar
  where party_id = p_party_id and account_id = auth.uid()
  returning * into result;

  if result.id is null then
    raise exception 'Not a member of this party';
  end if;

  return result;
end;
$$;

grant execute on function public.update_my_player_identity(uuid, text, text) to authenticated;

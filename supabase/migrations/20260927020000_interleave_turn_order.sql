-- Turn order used to go team-by-team within a round (team1's players one
-- after another, then team2's), so the same team held the "stage" for
-- several turns in a row before play ever moved to the other team. Deal it
-- like cards instead: one turn per team per pass through player positions
-- (team1's 1st player, team2's 1st player, team1's 2nd player, ...), so
-- turns alternate teams throughout, and only start repeating a team once
-- everyone else has had their position-matched turn too. Teams of uneven
-- size are handled by simply having nothing to contribute once a team runs
-- out of players at a given position.
create or replace function public.start_game(p_party_id uuid)
returns public.turns
language plpgsql
security definer
set search_path = public
as $$
declare
  party_row public.parties;
  order_entries jsonb := '[]'::jsonb;
  team_rec record;
  team_players uuid[];
  round_num int;
  player_pos int;
  max_team_size int;
  first_spectrum_id uuid;
  first_turn public.turns;
  first_team_id uuid;
  first_psychic_id uuid;
begin
  select * into party_row from public.parties where id = p_party_id and host_id = auth.uid() and status = 'lobby';
  if party_row.id is null then
    raise exception 'Not host or party not in lobby';
  end if;

  update public.teams set score = 0 where party_id = p_party_id;

  if exists (select 1 from public.players where party_id = p_party_id and team_id is null) then
    if party_row.team_mode = 'random' then
      perform public.shuffle_teams(p_party_id);
    else
      raise exception 'No teams assigned yet';
    end if;
  end if;

  select coalesce(max(cnt), 0) into max_team_size
  from (
    select count(*) as cnt
    from public.players pl
    join public.teams t on t.id = pl.team_id
    where t.party_id = p_party_id
    group by pl.team_id
  ) counts;

  for round_num in 1 .. party_row.rounds loop
    for player_pos in 0 .. max_team_size - 1 loop
      for team_rec in
        select id from public.teams t
        where t.party_id = p_party_id
          and exists (select 1 from public.players pl where pl.team_id = t.id)
        order by id
      loop
        select array_agg(id order by created_at) into team_players
        from public.players where team_id = team_rec.id;

        if player_pos < array_length(team_players, 1) then
          order_entries := order_entries || jsonb_build_object(
            'round', round_num, 'team_id', team_rec.id, 'psychic_player_id', team_players[player_pos + 1]
          );
        end if;
      end loop;
    end loop;
  end loop;

  if jsonb_array_length(order_entries) = 0 then
    raise exception 'No teams have players yet';
  end if;

  select (order_entries->0->>'team_id')::uuid, (order_entries->0->>'psychic_player_id')::uuid
  into first_team_id, first_psychic_id;

  select id into first_spectrum_id from public.spectrums
  where pack_id in (select pack_id from public.party_packs where party_id = p_party_id)
  order by random() limit 1;

  if first_spectrum_id is null then
    raise exception 'No spectrums available in the selected packs';
  end if;

  update public.parties
  set status = 'playing', turn_order = order_entries, turn_index = 0, has_started = true
  where id = p_party_id;

  update public.players set confirmed_rematch = false where party_id = p_party_id;

  insert into public.turns (party_id, round_number, team_id, psychic_player_id, spectrum_id, target_position)
  values (p_party_id, 1, first_team_id, first_psychic_id, first_spectrum_id, random())
  returning * into first_turn;

  update public.parties set used_spectrum_ids = array_append(used_spectrum_ids, first_spectrum_id) where id = p_party_id;

  return first_turn;
end;
$$;

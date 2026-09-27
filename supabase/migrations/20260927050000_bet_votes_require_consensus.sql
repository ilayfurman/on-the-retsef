-- place_bet let ANY single member of a betting team lock in that team's
-- whole bet by themselves (an upsert keyed on turn_id+team_id, last click
-- wins) — no visibility into what teammates picked, and no requirement
-- that they actually agree. Replaces it with per-player votes: a team's
-- bet only actually locks in (inserting into `bets`, which is what
-- reveal_turn scores) once every one of its players has independently
-- voted for the SAME side.
create table public.bet_votes (
  turn_id uuid not null references public.turns(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  team_id uuid not null references public.teams(id),
  direction text not null check (direction in ('left', 'right')),
  created_at timestamptz not null default now(),
  primary key (turn_id, player_id)
);

alter table public.bet_votes enable row level security;

-- Same visibility rule as `bets`: your own team's votes always visible (so
-- teammates can watch each other pick live), other teams' only once the
-- turn is revealed.
create policy "select own team votes or revealed" on public.bet_votes for select
  using (
    exists (select 1 from public.turns t where t.id = bet_votes.turn_id and t.status = 'revealed')
    or exists (
      select 1 from public.players pl where pl.team_id = bet_votes.team_id and pl.account_id = auth.uid()
    )
  );

create or replace function public.cast_bet_vote(p_turn_id uuid, p_direction text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.turns;
  my_player_id uuid;
  my_team_id uuid;
  team_size int;
  agreeing_count int;
  n_required_teams int;
  n_locked_bets int;
begin
  select * into t from public.turns where id = p_turn_id;
  if t.id is null then raise exception 'Turn not found'; end if;
  if t.status != 'betting' then raise exception 'Turn is not accepting bets'; end if;
  if p_direction not in ('left', 'right') then raise exception 'Direction must be left or right'; end if;

  select id, team_id into my_player_id, my_team_id
  from public.players where party_id = t.party_id and account_id = auth.uid();
  if my_player_id is null then raise exception 'Not a member of this party'; end if;
  if my_team_id is null then raise exception 'You are not on a team'; end if;
  if my_team_id = t.team_id then raise exception 'The active team cannot bet on its own turn'; end if;

  if exists (select 1 from public.bets where turn_id = p_turn_id and team_id = my_team_id) then
    raise exception 'Your team has already locked in a bet';
  end if;

  insert into public.bet_votes (turn_id, player_id, team_id, direction)
  values (p_turn_id, my_player_id, my_team_id, p_direction)
  on conflict (turn_id, player_id) do update set direction = excluded.direction;

  select count(*) into team_size from public.players where team_id = my_team_id;
  select count(*) into agreeing_count
  from public.bet_votes where turn_id = p_turn_id and team_id = my_team_id and direction = p_direction;

  -- Only lock the team's bet in once every one of its players has
  -- independently voted for this SAME side — a lone vote, or a split
  -- vote, never scores anything on its own.
  if agreeing_count = team_size then
    insert into public.bets (turn_id, team_id, direction) values (p_turn_id, my_team_id, p_direction)
    on conflict (turn_id, team_id) do nothing;

    select count(*) into n_required_teams
    from public.teams
    where party_id = t.party_id and id != t.team_id
      and exists (select 1 from public.players where team_id = teams.id);

    select count(*) into n_locked_bets from public.bets where turn_id = p_turn_id;

    if n_required_teams > 0 and n_locked_bets >= n_required_teams then
      perform public.reveal_turn(p_turn_id);
    end if;
  end if;
end;
$$;

grant execute on function public.cast_bet_vote(uuid, text) to authenticated;

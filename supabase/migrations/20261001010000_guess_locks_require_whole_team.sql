-- lock_guess let the FIRST guesser to press "Lock it in" finish the guess
-- for the whole team. Now every guesser (the team minus the psychic) has
-- to lock in at the SAME dial spot: the first lock sets the spot, the
-- others confirm it, and moving the dial clears every lock so the count
-- starts over. Only when all guessers agree does the turn move on.
create table public.guess_locks (
  turn_id uuid not null references public.turns(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  position numeric not null,
  created_at timestamptz not null default now(),
  primary key (turn_id, player_id)
);

alter table public.guess_locks enable row level security;

create policy "select guess locks if in party" on public.guess_locks for select
  using (
    exists (
      select 1 from public.turns t
      join public.players pl on pl.party_id = t.party_id
      where t.id = guess_locks.turn_id and pl.account_id = auth.uid()
    )
  );

create or replace function public.lock_guess(p_turn_id uuid, p_guess_position numeric)
returns public.turns_view
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.turns;
  my_player_id uuid;
  n_guessers int;
  n_agreeing int;
  n_teams int;
  result public.turns_view;
begin
  select * into t from public.turns where id = p_turn_id for update;
  if t.id is null then raise exception 'Turn not found'; end if;
  if t.status != 'guessing' then raise exception 'Turn is not awaiting a guess'; end if;

  select id into my_player_id from public.players
  where party_id = t.party_id and team_id = t.team_id and account_id = auth.uid();
  if my_player_id is null then
    raise exception 'Only the active team can lock in a guess';
  end if;
  if my_player_id = t.psychic_player_id then
    raise exception 'The psychic cannot lock in the guess';
  end if;
  if p_guess_position < 0 or p_guess_position > 1 then
    raise exception 'Guess must be between 0 and 1';
  end if;

  -- Locking in somewhere else than the others did means the dial moved:
  -- their agreement no longer counts, this lock starts a fresh round.
  delete from public.guess_locks
  where turn_id = p_turn_id and abs(position - p_guess_position) > 0.0001;

  insert into public.guess_locks (turn_id, player_id, position)
  values (p_turn_id, my_player_id, p_guess_position)
  on conflict (turn_id, player_id) do update set position = excluded.position, created_at = now();

  select count(*) into n_guessers from public.players
  where team_id = t.team_id and id != t.psychic_player_id;
  select count(*) into n_agreeing from public.guess_locks where turn_id = p_turn_id;

  if n_agreeing >= n_guessers then
    update public.turns set guess_position = p_guess_position, status = 'betting' where id = p_turn_id;
    select count(*) into n_teams from public.teams where party_id = t.party_id;
    if n_teams <= 1 then
      perform public.reveal_turn(p_turn_id);
    end if;
  end if;

  select * into result from public.turns_view where id = p_turn_id;
  return result;
end;
$$;

grant execute on function public.lock_guess(uuid, numeric) to authenticated;

-- Called when a guesser starts moving the dial: any locks so far were for
-- the old spot, so the count starts over.
create or replace function public.clear_guess_locks(p_turn_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.turns;
begin
  select * into t from public.turns where id = p_turn_id;
  if t.id is null or t.status != 'guessing' then return; end if;
  if not exists (
    select 1 from public.players where team_id = t.team_id and account_id = auth.uid()
  ) then
    raise exception 'Only the active team can move the guess';
  end if;
  delete from public.guess_locks where turn_id = p_turn_id;
end;
$$;

revoke all on function public.clear_guess_locks(uuid) from public;
grant execute on function public.clear_guess_locks(uuid) to authenticated;

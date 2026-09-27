-- Lets the psychic swap out the current turn's spectrum for a fresh random
-- one, once per turn, during the 'clue' phase — a genuine re-roll (new
-- left/right pair AND a new target position on it), not just a relabel.
alter table public.turns add column spectrum_rerolled boolean not null default false;

create or replace view public.turns_view as
select
  t.id,
  t.party_id,
  t.round_number,
  t.team_id,
  t.psychic_player_id,
  t.spectrum_id,
  case
    when t.status = 'revealed' then t.target_position
    when exists (
      select 1 from public.players p
      where p.id = t.psychic_player_id and p.account_id = auth.uid()
    ) then t.target_position
    else null
  end as target_position,
  t.clue_text,
  t.guess_position,
  t.status,
  t.created_at,
  t.spectrum_rerolled
from public.turns t
where exists (
  select 1 from public.players pl where pl.party_id = t.party_id and pl.account_id = auth.uid()
);

create or replace function public.reroll_spectrum(p_turn_id uuid)
returns public.turns_view
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.turns;
  new_spectrum_id uuid;
  result public.turns_view;
begin
  select * into t from public.turns where id = p_turn_id;
  if t.id is null then raise exception 'Turn not found'; end if;
  if t.status != 'clue' then raise exception 'Can only reroll during the clue phase'; end if;
  if t.spectrum_rerolled then raise exception 'Already rerolled this turn'; end if;
  if not exists (
    select 1 from public.players where id = t.psychic_player_id and account_id = auth.uid()
  ) then
    raise exception 'Only the psychic can reroll the spectrum';
  end if;

  select id into new_spectrum_id from public.spectrums
  where pack_id in (select pack_id from public.party_packs where party_id = t.party_id)
    and id != t.spectrum_id
    and id != all((select used_spectrum_ids from public.parties where id = t.party_id))
  order by random() limit 1;

  if new_spectrum_id is null then
    -- Ran out of unused spectrums other than the current one — allow a
    -- repeat rather than leaving the reroll with nothing to switch to.
    select id into new_spectrum_id from public.spectrums
    where pack_id in (select pack_id from public.party_packs where party_id = t.party_id)
      and id != t.spectrum_id
    order by random() limit 1;
  end if;

  if new_spectrum_id is null then
    raise exception 'No other spectrum available to reroll to';
  end if;

  update public.turns
  set spectrum_id = new_spectrum_id, target_position = random(), spectrum_rerolled = true
  where id = p_turn_id;

  update public.parties set used_spectrum_ids = array_append(used_spectrum_ids, new_spectrum_id) where id = t.party_id;

  select * into result from public.turns_view where id = p_turn_id;
  return result;
end;
$$;

grant execute on function public.reroll_spectrum(uuid) to authenticated;

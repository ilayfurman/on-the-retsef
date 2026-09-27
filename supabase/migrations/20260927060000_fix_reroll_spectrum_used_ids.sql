-- reroll_spectrum wrote `id != all((select used_spectrum_ids from parties ...))`,
-- which Postgres reads as ALL over a subquery returning one uuid[] ROW —
-- comparing a uuid against a uuid[] ("operator does not exist: uuid <>
-- uuid[]"), so every reroll failed. Read the array into a variable first and
-- compare against the array itself.
create or replace function public.reroll_spectrum(p_turn_id uuid)
returns public.turns_view
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.turns;
  used_ids uuid[];
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

  select coalesce(used_spectrum_ids, '{}') into used_ids from public.parties where id = t.party_id;

  select id into new_spectrum_id from public.spectrums
  where pack_id in (select pack_id from public.party_packs where party_id = t.party_id)
    and id != t.spectrum_id
    and id != all(used_ids)
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

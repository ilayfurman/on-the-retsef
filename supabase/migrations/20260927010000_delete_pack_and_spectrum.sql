-- Lets a host delete their own pack, or a single card out of it, from the
-- pack editor. spectrums.pack_id and party_packs.pack_id both cascade off
-- packs, but turns.spectrum_id has no cascade (deliberately — a played
-- card's history must survive) so it blocks the delete with a bare foreign
-- key violation. Both RPCs catch that and turn it into a message a player
-- actually understands instead of a raw Postgres error.

create or replace function public.delete_pack(p_pack_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.packs where id = p_pack_id and owner_id = auth.uid()) then
    raise exception 'Only the pack''s owner can delete it';
  end if;

  delete from public.packs where id = p_pack_id;
exception
  when foreign_key_violation then
    raise exception 'Can''t delete — one or more of its cards have already been played in a game';
end;
$$;

grant execute on function public.delete_pack(uuid) to authenticated;

create or replace function public.delete_spectrum(p_spectrum_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.spectrums s
    join public.packs p on p.id = s.pack_id
    where s.id = p_spectrum_id and p.owner_id = auth.uid()
  ) then
    raise exception 'Only the pack''s owner can delete this card';
  end if;

  delete from public.spectrums where id = p_spectrum_id;
exception
  when foreign_key_violation then
    raise exception 'Can''t delete — this card has already been played in a game';
end;
$$;

grant execute on function public.delete_spectrum(uuid) to authenticated;

-- Editing a card's two sides in place (pack owner only), instead of
-- deleting it and adding it again.
create or replace function public.update_spectrum(p_spectrum_id uuid, p_left_label text, p_right_label text)
returns public.spectrums
language plpgsql
security definer
set search_path = public
as $$
declare
  l text := btrim(coalesce(p_left_label, ''));
  r text := btrim(coalesce(p_right_label, ''));
  result public.spectrums;
begin
  if l = '' or r = '' then
    raise exception 'Both sides need some text';
  end if;
  update public.spectrums s set left_label = l, right_label = r
  where s.id = p_spectrum_id
    and exists (select 1 from public.packs p where p.id = s.pack_id and p.owner_id = auth.uid())
  returning * into result;
  if result.id is null then
    raise exception 'You can only edit cards in your own packs';
  end if;
  return result;
end;
$$;

revoke all on function public.update_spectrum(uuid, text, text) from public;
grant execute on function public.update_spectrum(uuid, text, text) to authenticated;

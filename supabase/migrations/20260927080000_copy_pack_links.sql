-- Pack share links (#/pack/CODE) hand out a *copy*: the recipient gets their
-- own pack to edit, trim or reshare, and nothing breaks when the original
-- changes or is deleted. copied_from remembers the source so opening the
-- same link twice can say "you already have this pack".
alter table public.packs add column if not exists copied_from uuid references public.packs(id) on delete set null;

-- What a share link points at, for the "Add to my packs" screen. Works signed
-- out too (name + card count only). my_copy_id: your newest copy, if any.
create or replace function public.pack_preview(p_share_code text)
returns table (name text, card_count int, is_mine boolean, my_copy_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.name,
    (select count(*)::int from public.spectrums s where s.pack_id = p.id),
    coalesce(p.owner_id = auth.uid(), false),
    (select c.id from public.packs c where c.copied_from = p.id and c.owner_id = auth.uid() order by c.created_at desc limit 1)
  from public.packs p
  where p.share_code = upper(p_share_code);
$$;

revoke all on function public.pack_preview(text) from public;
grant execute on function public.pack_preview(text) to anon, authenticated;

create or replace function public.copy_pack(p_share_code text)
returns public.packs
language plpgsql
security definer
set search_path = public
as $$
declare
  src public.packs;
  result public.packs;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Sign in to save packs';
  end if;
  perform public.ensure_profile();

  select * into src from public.packs where share_code = upper(p_share_code);
  if src.id is null then
    raise exception 'No pack with that code';
  end if;

  insert into public.packs (owner_id, name, share_code, copied_from)
  values (auth.uid(), src.name, public.generate_share_code(), src.id)
  returning * into result;

  insert into public.spectrums (pack_id, left_label, right_label)
  select result.id, s.left_label, s.right_label from public.spectrums s where s.pack_id = src.id;

  return result;
end;
$$;

revoke all on function public.copy_pack(text) from public;
grant execute on function public.copy_pack(text) to authenticated;

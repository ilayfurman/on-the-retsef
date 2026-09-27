-- Renaming a pack (owner only). Packs have no UPDATE policy, so this goes
-- through a checked function like the other pack edits.
create or replace function public.rename_pack(p_pack_id uuid, p_name text)
returns public.packs
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text := left(btrim(coalesce(p_name, '')), 40);
  result public.packs;
begin
  if clean = '' then
    raise exception 'Pack name can''t be empty';
  end if;
  update public.packs set name = clean
  where id = p_pack_id and owner_id = auth.uid()
  returning * into result;
  if result.id is null then
    raise exception 'You can only rename your own packs';
  end if;
  return result;
end;
$$;

revoke all on function public.rename_pack(uuid, text) from public;
grant execute on function public.rename_pack(uuid, text) to authenticated;

begin;

alter table public.profiles
  add column if not exists theme_preference text not null default 'default';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_theme_preference_check'
  ) then
    alter table public.profiles
      add constraint profiles_theme_preference_check
      check (
        theme_preference in (
          'default',
          'minimal',
          'clay',
          'aurora',
          'glass',
          'bento',
          'neobrutal'
        )
      );
  end if;
end $$;

commit;

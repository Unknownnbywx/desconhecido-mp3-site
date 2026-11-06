begin;

alter table public.site_updates
  add column if not exists content_type text not null default 'update',
  add column if not exists youtube_url text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'site_updates_content_type_check'
      and conrelid = 'public.site_updates'::regclass
  ) then
    alter table public.site_updates
      add constraint site_updates_content_type_check
      check (content_type in ('update', 'video', 'live'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'site_updates_youtube_url_check'
      and conrelid = 'public.site_updates'::regclass
  ) then
    alter table public.site_updates
      add constraint site_updates_youtube_url_check
      check (
        (content_type = 'update' and youtube_url is null)
        or (
          content_type = 'video'
          and youtube_url is not null
          and youtube_url ~ '^https://www[.]youtube[.]com/watch[?]v=[A-Za-z0-9_-]{11}$'
        )
        or (
          content_type = 'live'
          and youtube_url is not null
          and (
            youtube_url ~ '^https://www[.]youtube[.]com/watch[?]v=[A-Za-z0-9_-]{11}$'
            or youtube_url ~ '^https://www[.]youtube[.]com/@[A-Za-z0-9._-]{3,30}/live$'
          )
        )
      );
  end if;
end
$$;

create table if not exists public.site_push_subscriptions (
  endpoint text primary key check (char_length(endpoint) between 1 and 2048),
  p256dh text not null check (char_length(p256dh) between 40 and 100),
  auth text not null check (char_length(auth) between 16 and 64),
  client_ip_hash text not null check (char_length(client_ip_hash) = 64),
  created_at timestamptz not null default now()
);

create index if not exists site_push_subscriptions_ip_created_idx
  on public.site_push_subscriptions (client_ip_hash, created_at desc);

alter table public.site_push_subscriptions enable row level security;
revoke all on table public.site_push_subscriptions from public, anon, authenticated;
grant all on table public.site_push_subscriptions to service_role;

commit;

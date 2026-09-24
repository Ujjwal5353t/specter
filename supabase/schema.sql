-- Specter database schema. Run once in Supabase Dashboard -> SQL Editor.
-- Columns are derived from src/app/api/scan/**/route.ts.

create table if not exists public.scans (
  id            uuid primary key default gen_random_uuid(),
  repo_url      text not null,
  repo_owner    text not null,
  repo_name     text not null,
  status        text not null default 'pending'
                check (status in ('pending', 'scanning', 'completed', 'failed')),
  threat_score  integer,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz,
  error_message text
);

-- For databases created before error_message existed.
alter table public.scans add column if not exists error_message text;

create table if not exists public.findings (
  id            uuid primary key default gen_random_uuid(),
  scan_id       uuid not null references public.scans(id) on delete cascade,
  scanner       text not null,
  severity      text not null,
  title         text,
  detail        text,
  package_name  text,
  file_path     text,
  line_number   integer,
  commit_sha    text,
  metadata      jsonb,
  created_at    timestamptz not null default now()
);

-- repo_url must be the primary key (or unique): /run upserts on it.
create table if not exists public.scan_cache (
  repo_url      text primary key,
  dep_data      jsonb,
  secret_data   jsonb,
  docker_data   jsonb,
  api_data      jsonb,
  env_data      jsonb,
  threat_score  integer,
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now()
);

create index if not exists findings_scan_id_idx on public.findings (scan_id);
create index if not exists scans_repo_url_idx   on public.scans (repo_url);

-- The app only talks to Supabase from the server with the secret key, which bypasses RLS.
-- Enabling RLS with no policies blocks anyone using the publishable key from reading these tables.
alter table public.scans      enable row level security;
alter table public.findings   enable row level security;
alter table public.scan_cache enable row level security;

-- Make PostgREST pick up the new tables immediately.
notify pgrst, 'reload schema';

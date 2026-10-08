-- Run this once in Supabase: SQL Editor, New query, paste, Run.
-- The table is locked down. The app can only read or save ONE household's list at a time,
-- and only if it knows that household's long secret code.

create table if not exists households (
  code text primary key,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
alter table households enable row level security;   -- no policies = no direct access

create or replace function get_household(p_code text)
returns jsonb language sql security definer set search_path = public as $$
  select data from households where code = p_code
$$;

create or replace function save_household(p_code text, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if length(p_code) < 16 then raise exception 'code too short'; end if;
  if pg_column_size(p_data) > 100000 then raise exception 'data too large'; end if;
  insert into households (code, data, updated_at) values (p_code, p_data, now())
  on conflict (code) do update set data = excluded.data, updated_at = now();
end
$$;

revoke all on function get_household(text) from public;
revoke all on function save_household(text, jsonb) from public;
grant execute on function get_household(text) to anon;
grant execute on function save_household(text, jsonb) to anon;

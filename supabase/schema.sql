-- Torix CRM schema for Supabase Postgres
-- Run once in Supabase SQL Editor.

create table if not exists workspaces (
  id text primary key,
  user_id text not null,
  mode text not null,
  revision integer not null default 0
);
create unique index if not exists workspace_user_mode on workspaces (user_id, mode);

create table if not exists records (
  id text primary key,
  workspace_id text not null references workspaces(id),
  kind text not null,
  payload text not null,
  archived integer not null default 0,
  created_at text not null,
  updated_at text not null,
  source_key text
);
create index if not exists records_workspace_kind on records (workspace_id, kind);
create unique index if not exists record_source_key on records (workspace_id, kind, source_key);

create table if not exists finance_events (
  id text primary key,
  workspace_id text not null references workspaces(id),
  kind text not null,
  amount integer not null,
  event_date text not null,
  department text not null,
  client_id text,
  order_id text,
  person text,
  note text not null,
  ledger text not null,
  reverses text,
  created_at text not null,
  meta text not null default '{}'
);
create index if not exists events_workspace_date on finance_events (workspace_id, event_date);
create unique index if not exists event_single_reversal on finance_events (workspace_id, reverses);

create table if not exists audit_events (
  id text primary key,
  workspace_id text not null references workspaces(id),
  action text not null,
  record_id text not null,
  detail text not null,
  created_at text not null,
  actor text not null default 'Owner'
);
create index if not exists audit_workspace on audit_events (workspace_id);

create table if not exists companies (
  id text primary key,
  owner_id text not null,
  created_at text not null
);

create table if not exists company_members (
  id text primary key,
  company_id text not null references companies(id),
  email text not null,
  user_id text,
  role text not null,
  departments text not null,
  grants text not null,
  employee_id text,
  active integer not null default 1,
  updated_at text not null
);
create unique index if not exists member_company_email on company_members (company_id, email);

create table if not exists operations (
  id text primary key,
  workspace_id text not null references workspaces(id),
  created_at text not null
);

-- Private file bucket for documents / backups (create via dashboard or API if this fails)
-- Storage → New bucket → name: torix-files → Private

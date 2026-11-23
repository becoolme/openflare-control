-- Reference plane schema (Postgres). Single owner; cell id == cluster id.
create table if not exists plane_cells (
  cell_id text primary key,
  cluster_id text not null unique,
  revision bigint not null default 0 check (revision >= 0),
  capabilities jsonb
);

-- Per-cell pull credentials. The plaintext token is returned exactly once by
-- POST /api/v1/cells/:cellId/token; only the sha256 lives here, so a database
-- read cannot mint a credential and one leaked token cannot reach another
-- cell's data (render-inputs carries every worker secret of its cell).
create table if not exists plane_cell_tokens (
  cell_id text primary key references plane_cells(cell_id) on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists plane_teams (
  team_id text primary key,
  name text not null,
  plan text not null default 'Free',
  created_at timestamptz not null default now()
);

create table if not exists plane_team_quotas (
  team_id text primary key references plane_teams(team_id) on delete cascade,
  requests_month bigint not null default 100000000 check (requests_month >= 0),
  cpu_ms_month bigint not null default 3600000000 check (cpu_ms_month >= 0),
  workers_max integer not null default 100 check (workers_max >= 0)
);

create table if not exists plane_hyperdrives (
  hyperdrive_id text primary key,
  team_id text not null,
  cluster_id text not null,
  name text not null,
  origin text not null,
  caching boolean not null default true,
  created_at timestamptz not null default now(),
  unique (team_id, cluster_id, name)
);

create table if not exists plane_workers (
  id text primary key,
  team_id text not null,
  cluster_id text not null,
  name text not null,
  runtime text not null default 'VRT',
  status text not null default 'ACTIVE',
  active_version_id text,
  entrypoint text not null default 'src/index.ts',
  compatibility_date text not null default '2024-01-01',
  status_reason text,
  unique (team_id, cluster_id, name)
);

create table if not exists plane_versions (
  version_id text primary key,
  worker_id text not null references plane_workers(id) on delete cascade,
  bundle_sha256 text not null,
  bindings_fingerprint text not null,
  status text not null default 'UPLOADED'
    check (status in ('UPLOADED','ACTIVE','SUPERSEDED','FAILED')),
  status_reason text,
  row jsonb not null,
  created_at timestamptz not null default now(),
  unique (worker_id, bundle_sha256, bindings_fingerprint)
);

create table if not exists plane_publications (
  id uuid primary key default gen_random_uuid(),
  cell_id text not null,
  revision bigint not null,
  envelope jsonb not null,
  payload_digest text not null,
  envelope_digest text not null,
  cause text not null,
  worker_id text,
  version_id text,
  published_by_id text,
  published_by_source text not null default 'USER',
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  ack_status text not null default 'PENDING'
    check (ack_status in ('PENDING','ACKED','SUPERSEDED','EXPIRED','APPLIED','REJECTED','PARTIAL')),
  acked_at timestamptz,
  ack_revision bigint,
  ack_envelope_digest text,
  ack_reason text,
  ack_tenant_failures jsonb,
  unique (cell_id, revision)
);
create index if not exists plane_publications_cell_rev on plane_publications (cell_id, revision desc);

create table if not exists plane_vars (
  worker_id text not null references plane_workers(id) on delete cascade,
  key text not null,
  value text not null,
  primary key (worker_id, key)
);

create table if not exists plane_secrets (
  worker_id text not null references plane_workers(id) on delete cascade,
  key text not null,
  value text not null,
  primary key (worker_id, key)
);

create table if not exists plane_hostnames (
  id text primary key,
  hostname text not null,
  worker_id text not null references plane_workers(id) on delete cascade,
  status text not null default 'VERIFIED',
  kind text not null default 'CUSTOM',
  unique (hostname, worker_id)
);

create table if not exists plane_bundle_objects (
  digest text primary key,
  bytes bigint not null,
  created_at timestamptz not null default now(),
  last_referenced_at timestamptz not null default now()
);

create table if not exists plane_cell_ops (
  id text primary key,
  seq bigserial unique,
  cell_id text not null,
  worker_id text,
  resource_key text not null default '',
  kind text not null,
  payload jsonb not null,
  status text not null default 'PENDING',
  result jsonb,
  error text,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists plane_cell_ops_status_created on plane_cell_ops (status, created_at);

create table if not exists plane_d1_databases (
  database_id text primary key,
  team_id text not null,
  cluster_id text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (team_id, cluster_id, name)
);

create table if not exists plane_r2_buckets (
  bucket_name text primary key,
  bucket_id text not null unique,
  team_id text not null,
  cluster_id text not null,
  created_at timestamptz not null default now()
);

create table if not exists plane_kv_namespaces (
  namespace_id text primary key,
  physical_id text not null unique,
  team_id text not null,
  cluster_id text not null,
  title text not null,
  created_at timestamptz not null default now(),
  unique (team_id, cluster_id, title)
);

create table if not exists plane_queues (
  queue_id text primary key,
  team_id text not null,
  cluster_id text not null,
  name text not null,
  delivery_delay_seconds integer check (delivery_delay_seconds between 0 and 86400),
  created_at timestamptz not null default now(),
  unique (team_id, cluster_id, name)
);

create table if not exists plane_do_classes (
  worker_id text not null references plane_workers(id) on delete cascade,
  class_name text not null,
  unique_key text not null,
  enable_sql boolean not null default true,
  transfer_from_worker_id text,
  created_at timestamptz not null default now(),
  primary key (worker_id, class_name)
);

create table if not exists plane_workflows (
  workflow_id text primary key,
  worker_id text not null references plane_workers(id) on delete cascade,
  team_id text not null,
  cluster_id text not null,
  name text not null,
  class_name text not null,
  binding text,
  unique_key text,
  limits_steps integer,
  service_worker_id text,
  created_at timestamptz not null default now(),
  unique (worker_id, name)
);
-- Upgrade rows created before workflow declarations were wired. Nullable
-- columns keep old rows readable; cellView ignores incomplete declarations.
alter table plane_workflows add column if not exists binding text;
alter table plane_workflows add column if not exists unique_key text;
alter table plane_workflows add column if not exists limits_steps integer;
alter table plane_workflows add column if not exists service_worker_id text;
create unique index if not exists plane_workflows_worker_binding
  on plane_workflows (worker_id, binding) where binding is not null;
create unique index if not exists plane_workflows_target_name
  on plane_workflows (coalesce(service_worker_id, worker_id), name);

create table if not exists plane_logs (
  id bigserial primary key,
  cell_id text not null,
  pod_id text,
  boot_id text not null default '',
  worker_id text not null,
  seq bigint not null,
  ts_ms bigint not null,
  level text not null default 'info',
  kind text not null default '',
  message text not null default '',
  outcome text,
  status integer,
  code text,
  truncated boolean not null default false,
  created_at timestamptz not null default now(),
  unique (cell_id, worker_id, boot_id, seq)
);
create index if not exists plane_logs_cell_ts on plane_logs (cell_id, ts_ms desc);
create index if not exists plane_logs_created on plane_logs (created_at);

create table if not exists plane_d1_ops (
  id text primary key,
  seq bigserial unique,
  cell_id text not null,
  database_id text not null,
  kind text not null,
  payload jsonb not null,
  status text not null default 'PENDING',
  result jsonb,
  error text,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists plane_d1_ops_status_created on plane_d1_ops (status, created_at);

create table if not exists plane_cell_metrics (
  id bigserial primary key,
  cell_id text not null,
  sampled_at timestamptz not null,
  window_ms bigint not null default 0,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists plane_cell_metrics_cell_sampled on plane_cell_metrics (cell_id, sampled_at desc);
-- A retried push must not double-count a window: (cell, sampledAt) is the
-- report's identity (the runtime ticks far slower than 1 ms).
create unique index if not exists plane_cell_metrics_cell_sampled_unique
  on plane_cell_metrics (cell_id, sampled_at);
create index if not exists plane_cell_metrics_created on plane_cell_metrics (created_at);

create table if not exists plane_cell_resources (
  cell_id text primary key,
  sampled_at timestamptz not null,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

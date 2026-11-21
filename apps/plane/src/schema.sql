-- Reference plane schema (Postgres). Single owner; cell id == cluster id.
create table if not exists plane_cells (
  cell_id text primary key,
  cluster_id text not null unique,
  revision bigint not null default 0 check (revision >= 0),
  capabilities jsonb
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

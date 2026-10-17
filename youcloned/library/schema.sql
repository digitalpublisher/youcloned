-- YouCloned library: the buyer's own searchable history (search by meaning and by words) plus a wiki.
-- One migration, safe to run again: every statement checks before it creates.
-- Nothing here is reachable from the public API. Only the library Edge Function reads and writes,
-- through the database connection Supabase gives that function.

create schema if not exists youcloned;
create extension if not exists vector with schema extensions;

create table if not exists youcloned.sources (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('email', 'web', 'youtube', 'doc', 'note', 'other')),
  ref text not null unique,
  title text not null default '',
  happened_at timestamptz,
  words int not null default 0,
  added_at timestamptz not null default now()
);

create table if not exists youcloned.chunks (
  id bigint generated always as identity primary key,
  source_id bigint not null references youcloned.sources (id) on delete cascade,
  n int not null,
  content text not null,
  embedding extensions.vector(384),
  fts tsvector generated always as (to_tsvector('english', content)) stored,
  unique (source_id, n)
);

create index if not exists chunks_embedding_hnsw on youcloned.chunks
  using hnsw (embedding extensions.vector_cosine_ops);
create index if not exists chunks_fts_gin on youcloned.chunks using gin (fts);
create index if not exists sources_kind_idx on youcloned.sources (kind);

create table if not exists youcloned.wiki_pages (
  slug text primary key,
  title text not null default '',
  body text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists youcloned.settings (
  k text primary key,
  v text not null
);

-- Reciprocal rank fusion of keyword results and meaning results, after the Supabase hybrid search guide.
-- Cosine distance (<=>) to match the HNSW index above. kinds, when given, limits the source kinds searched.
create or replace function youcloned.hybrid_search(
  query_text text,
  query_embedding extensions.vector(384),
  match_count int default 8,
  kinds text[] default null
)
returns table (title text, kind text, ref text, content text, score double precision)
language sql
stable
set search_path = youcloned, extensions, pg_catalog
as $$
  with params as (
    select websearch_to_tsquery('english', coalesce(query_text, '')) as q,
           greatest(1, least(coalesce(match_count, 8), 30)) as lim,
           50 as rrf_k
  ),
  full_text as (
    select c.id,
           row_number() over (order by ts_rank_cd(c.fts, p.q) desc) as rank_ix
    from youcloned.chunks c
    join youcloned.sources s on s.id = c.source_id
    cross join params p
    where c.fts @@ p.q
      and (kinds is null or s.kind = any (kinds))
    order by rank_ix
    limit (select lim * 2 from params)
  ),
  semantic as (
    select c.id,
           row_number() over (order by c.embedding <=> query_embedding) as rank_ix
    from youcloned.chunks c
    join youcloned.sources s on s.id = c.source_id
    where query_embedding is not null
      and c.embedding is not null
      and (kinds is null or s.kind = any (kinds))
    order by rank_ix
    limit (select lim * 2 from params)
  )
  select s.title, s.kind, s.ref, c.content,
         (coalesce(1.0 / ((select rrf_k from params) + ft.rank_ix), 0.0)
          + coalesce(1.0 / ((select rrf_k from params) + se.rank_ix), 0.0))::double precision as score
  from full_text ft
  full outer join semantic se on ft.id = se.id
  join youcloned.chunks c on c.id = coalesce(ft.id, se.id)
  join youcloned.sources s on s.id = c.source_id
  order by score desc
  limit (select lim from params)
$$;

-- Lock everything down: row level security on, no policies, and no grants to the public API roles.
alter table youcloned.sources enable row level security;
alter table youcloned.chunks enable row level security;
alter table youcloned.wiki_pages enable row level security;
alter table youcloned.settings enable row level security;

revoke all on schema youcloned from public, anon, authenticated;
revoke all on all tables in schema youcloned from public, anon, authenticated;
revoke all on all sequences in schema youcloned from public, anon, authenticated;
revoke all on all functions in schema youcloned from public, anon, authenticated;
alter default privileges in schema youcloned revoke all on tables from public, anon, authenticated;
alter default privileges in schema youcloned revoke all on sequences from public, anon, authenticated;
alter default privileges in schema youcloned revoke all on functions from public, anon, authenticated;

grant usage on schema youcloned to service_role;
grant all on all tables in schema youcloned to service_role;
grant all on all sequences in schema youcloned to service_role;
grant execute on function youcloned.hybrid_search(text, extensions.vector, int, text[]) to service_role;

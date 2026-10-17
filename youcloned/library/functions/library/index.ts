// YouCloned library: one Edge Function the clone and its librarian helper call to feed and search
// the buyer's own library. Deployed with verify_jwt false; the x-library-token header is the lock.
//
// It talks to the database over the connection Supabase hands every function (SUPABASE_DB_URL),
// so the youcloned schema never has to be opened to the public API.
// Embeddings come from Supabase's built-in gte-small model (384 numbers per piece of text).

import postgres from 'npm:postgres@3.4.5'

declare const Supabase: {
  ai: { Session: new (model: string) => { run: (input: string, opts: Record<string, unknown>) => Promise<unknown> } }
}

const KINDS = ['email', 'web', 'youtube', 'doc', 'note', 'other']
const MAX_TEXT = 400_000
const MAX_BODY = 2_000_000
const CHUNK_WORDS = 350
const OVERLAP_WORDS = 50

const sql = postgres(Deno.env.get('SUPABASE_DB_URL') ?? '', { prepare: false, max: 3, idle_timeout: 20 })
const model = new Supabase.ai.Session('gte-small')

class Fail extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// Every reply carries this header, so setup can tell a function of ours from another one with the same name.
const MARKER = 'x-youcloned-library'
const VERSION = '2'

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', [MARKER]: VERSION } })
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

// Constant-time compare of two hex strings of the same expected length.
function sameHex(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

async function authorized(req: Request): Promise<boolean> {
  const token = req.headers.get('x-library-token')
  if (!token) return false
  const rows = await sql`select v from youcloned.settings where k = 'token_sha256'`
  const stored = String(rows[0]?.v ?? '').trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(stored)) return false
  return sameHex(await sha256Hex(token), stored)
}

async function embed(text: string): Promise<string> {
  const out = await model.run(text, { mean_pool: true, normalize: true })
  const values = Array.from(out as ArrayLike<number>)
  if (values.length !== 384) throw new Error('embedding has ' + values.length + ' numbers, expected 384')
  return '[' + values.join(',') + ']'
}

const countWords = (text: string) => (text.match(/\S+/g) ?? []).length

// Sentences, each marked when it starts a paragraph. A sentence longer than one chunk is cut by words.
function units(text: string): { text: string, words: number, para: boolean }[] {
  const out: { text: string, words: number, para: boolean }[] = []
  for (const paragraph of text.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const flat = paragraph.replace(/\s+/g, ' ').trim()
    if (!flat) continue
    let first = true
    for (const sentence of flat.split(/(?<=[.!?])\s+(?=\S)/)) {
      const words = sentence.split(' ').filter(Boolean)
      for (let i = 0; i < words.length; i += CHUNK_WORDS) {
        const piece = words.slice(i, i + CHUNK_WORDS)
        out.push({ text: piece.join(' '), words: piece.length, para: first })
        first = false
      }
    }
  }
  return out
}

// About 350 words a chunk, about 50 words carried over from the end of the chunk before,
// always cut between sentences.
export function chunkText(text: string): string[] {
  const all = units(text)
  const chunks: string[] = []
  let current: typeof all = []
  let words = 0
  let fresh = 0
  const join = (list: typeof all) => list.map((u, i) => (i > 0 ? (u.para ? '\n\n' : ' ') : '') + u.text).join('')
  for (const unit of all) {
    if (fresh > 0 && words + unit.words > CHUNK_WORDS) {
      chunks.push(join(current))
      const carry: typeof all = []
      let carried = 0
      for (let i = current.length - 1; i >= 0 && carried + current[i].words <= OVERLAP_WORDS; i--) {
        carry.unshift(current[i])
        carried += current[i].words
      }
      current = carry
      words = carried
      fresh = 0
    }
    current.push(unit)
    words += unit.words
    fresh += 1
  }
  if (fresh > 0) chunks.push(join(current))
  return chunks
}

const text = (v: unknown, name: string, max: number, required = true): string => {
  if (v === undefined || v === null || v === '') {
    if (required) throw new Fail(400, name + ' is required')
    return ''
  }
  if (typeof v !== 'string') throw new Fail(400, name + ' must be text')
  if (v.length > max) throw new Fail(413, name + ' is longer than ' + max + ' characters')
  return v
}

async function ingest(body: Record<string, unknown>) {
  const source = (body.source ?? {}) as Record<string, unknown>
  const kind = text(source.kind, 'source.kind', 20)
  if (!KINDS.includes(kind)) throw new Fail(400, 'source.kind must be one of ' + KINDS.join(', '))
  const ref = text(source.ref, 'source.ref', 2000).trim()
  const title = text(source.title, 'source.title', 1000, false).trim() || ref
  let happened: string | null = null
  if (source.happened_at) {
    const when = new Date(String(source.happened_at))
    if (isNaN(when.getTime())) throw new Fail(400, 'source.happened_at is not a date')
    happened = when.toISOString()
  }
  const content = text(body.text, 'text', MAX_TEXT)
  const pieces = chunkText(content)
  if (!pieces.length) throw new Fail(400, 'text has no words')
  const words = countWords(content)

  const vectors: string[] = []
  for (const piece of pieces) vectors.push(await embed(piece))

  const sourceId = await sql.begin(async (tx) => {
    const [row] = await tx`
      insert into youcloned.sources (kind, ref, title, happened_at, words)
      values (${kind}, ${ref}, ${title}, ${happened}, ${words})
      on conflict (ref) do update set kind = excluded.kind, title = excluded.title,
        happened_at = excluded.happened_at, words = excluded.words, added_at = now()
      returning id`
    await tx`delete from youcloned.chunks where source_id = ${row.id}`
    for (let n = 0; n < pieces.length; n++) {
      await tx`insert into youcloned.chunks (source_id, n, content, embedding)
        values (${row.id}, ${n}, ${pieces[n]}, ${vectors[n]}::extensions.vector)`
    }
    return row.id
  })
  return { ok: true, source_id: Number(sourceId), chunks: pieces.length, words }
}

async function search(body: Record<string, unknown>) {
  const query = text(body.query, 'query', 2000).trim()
  if (!query) throw new Fail(400, 'query is required')
  const k = Math.max(1, Math.min(30, Number.isFinite(Number(body.k)) && body.k !== undefined ? Math.floor(Number(body.k)) : 8))
  let kinds: string | null = null
  if (body.kinds !== undefined && body.kinds !== null) {
    if (!Array.isArray(body.kinds) || body.kinds.some((x) => !KINDS.includes(String(x)))) {
      throw new Fail(400, 'kinds must be a list from ' + KINDS.join(', '))
    }
    if (body.kinds.length) kinds = body.kinds.join(',')
  }
  const vector = await embed(query)
  const rows = await sql`
    select title, kind, ref, content, score
    from youcloned.hybrid_search(${query}, ${vector}::extensions.vector, ${k},
      case when ${kinds}::text is null then null else string_to_array(${kinds}::text, ',') end)`
  return { ok: true, results: rows.map((r) => ({ title: r.title, kind: r.kind, ref: r.ref, content: r.content, score: Number(r.score) })) }
}

const slugOf = (v: unknown) => {
  const slug = text(v, 'slug', 200).trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9/_-]*$/.test(slug)) throw new Fail(400, 'slug may use only a to z, 0 to 9, hyphens, underscores and slashes')
  return slug
}

async function wikiUpsert(body: Record<string, unknown>) {
  const slug = slugOf(body.slug)
  const title = text(body.title, 'title', 1000).trim()
  const page = text(body.body, 'body', MAX_TEXT, false)
  const [row] = await sql`
    insert into youcloned.wiki_pages (slug, title, body, updated_at) values (${slug}, ${title}, ${page}, now())
    on conflict (slug) do update set title = excluded.title, body = excluded.body, updated_at = now()
    returning slug, updated_at`
  return { ok: true, slug: row.slug, updated_at: row.updated_at }
}

async function wikiGet(body: Record<string, unknown>) {
  const slug = slugOf(body.slug)
  const [row] = await sql`select slug, title, body, updated_at from youcloned.wiki_pages where slug = ${slug}`
  if (!row) throw new Fail(404, 'no wiki page with that slug')
  return { ok: true, page: row }
}

async function wikiList() {
  const rows = await sql`select slug, title, updated_at from youcloned.wiki_pages order by updated_at desc limit 1000`
  return { ok: true, pages: rows }
}

async function stats() {
  const kinds = await sql`select kind, count(*)::int as n from youcloned.sources group by kind`
  const [totals] = await sql`
    select (select count(*)::int from youcloned.sources) as sources,
           (select count(*)::int from youcloned.chunks) as chunks,
           (select count(*)::int from youcloned.wiki_pages) as wiki_pages,
           (select max(added_at) from youcloned.sources) as last_added`
  const perKind: Record<string, number> = Object.fromEntries(KINDS.map((k) => [k, 0]))
  for (const row of kinds) perKind[row.kind] = row.n
  return { ok: true, kinds: perKind, ...totals }
}

// Which of these refs are in the library (feed.py asks before it skips what it fed before).
async function has(body: Record<string, unknown>) {
  if (!Array.isArray(body.refs) || body.refs.length > 1000) throw new Fail(400, 'refs must be a list of at most 1000')
  const refs = body.refs.map((r) => text(r, 'ref', 2000))
  if (!refs.length) return { ok: true, refs: [] }
  const rows = await sql`select ref from youcloned.sources where ref in ${sql(refs)}`
  return { ok: true, refs: rows.map((r) => r.ref) }
}

async function forget(body: Record<string, unknown>) {
  const ref = text(body.ref, 'ref', 2000).trim()
  const rows = await sql`delete from youcloned.sources where ref = ${ref} returning id`
  return { ok: true, forgotten: rows.length }
}

const ACTIONS: Record<string, (body: Record<string, unknown>) => Promise<unknown>> = {
  ingest, search, stats, has, forget,
  wiki_upsert: wikiUpsert, wiki_get: wikiGet, wiki_list: wikiList,
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return reply(405, { ok: false, error: 'use POST', youcloned: 'library', version: VERSION })
    if (!(await authorized(req))) return reply(401, { ok: false, error: 'unauthorized' })
    const raw = await req.text()
    if (raw.length > MAX_BODY) return reply(413, { ok: false, error: 'request is too large' })
    let body: Record<string, unknown>
    try {
      body = JSON.parse(raw)
    } catch {
      return reply(400, { ok: false, error: 'body must be JSON' })
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { ok: false, error: 'body must be a JSON object' })
    const run = ACTIONS[String(body.action)]
    if (!run) return reply(400, { ok: false, error: 'unknown action; use one of ' + Object.keys(ACTIONS).join(', ') })
    return reply(200, await run(body))
  } catch (err) {
    if (err instanceof Fail) return reply(err.status, { ok: false, error: err.message })
    console.error('library error:', err instanceof Error ? err.message : String(err))
    return reply(500, { ok: false, error: 'the library hit an internal error' })
  }
})

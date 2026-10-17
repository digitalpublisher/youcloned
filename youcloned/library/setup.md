# Setting up the buyer's library

These are the steps you (the clone) follow to build the buyer's own library in their Supabase account.
The library keeps everything they feed you (sent emails, web pages, YouTube transcripts, documents, notes)
and lets you search it two ways: by meaning, and by exact words. It also holds a small wiki of pages you write.

Everything here lives in the buyer's account, not ours. Talk to the buyer in short, friendly sentences.
They are not technical, so never ask them to type a command or read code.
Do each step yourself with the Supabase connector's tools and the scripts in this folder.

Two rules for the whole setup:

- The library token is a password. It is made by `make-token.py` and goes only into the buyer's env file.
  Never show it, say it, put it in chat, a note, the wiki, or any other file, and never open or print the env file.
- Never create a paid Supabase project. If anything would cost money, tell the buyer the price and stop unless they say yes.

"This folder" below means the `library` folder this file is in.
"The vault" means the folder named in `~/.youcloned/vault-path` (usually the Obsidian Vault folder inside their Documents folder).
"The env file" means the file called `.env` at the top of the vault.

## Step 1: Check the Supabase connector

Call `list_projects`.
If the tool is missing, ask the buyer one question:
"Next I need a Supabase account for your library. Do you already have one, or should I walk you through the free one I recommend?"
Both answers start the same way, so then tell them:
"In Claude Desktop open Settings, then Connectors, find Supabase and press Connect.
If you already have an account, sign in with it. If not, it lets you make a free one right there. Tell me when it says connected."
Wait for them, then call `list_projects` again.

## Step 2: Pick the project

If `list_projects` shows a project called `youcloned-library`, that is a library from an earlier setup: use it and go to "Check for an earlier library" below.

Otherwise give the buyer two choices in one message:

- **Use a project I already have** (only offer this when `list_projects` shows at least one project)
- **Make the free one you recommend**

### Path A: use a project they already have

1. List their projects by name (and region) and let them pick one. Ask once; never guess.
2. Tell them in one sentence that the library goes into its own separate section of that project (called `youcloned`), so nothing of theirs is touched.
3. Call `get_project` and make sure its status is `ACTIVE_HEALTHY`. If it is paused, ask before waking it with `restore_project`.
4. Go to "Check for an earlier library" below.

### Path B: make the free one

1. Call `list_organizations` and use their organization (ask which, only if there is more than one).
2. Call `get_cost` for a project in that organization.
3. If the cost is $0, tell the buyer: "I'm making a free Supabase project for your library. Free projects go to sleep after about a week with no use; I wake it up if that happens." Then go on.
4. If the cost is more than $0 (the free plan allows two free projects, so they may already have used theirs), tell the buyer the exact amount and stop.
   Offer Path A instead, with one of their existing projects. Never create a paid project unless they clearly say yes to paying that amount.
5. Call `confirm_cost`, then `create_project` with the name `youcloned-library`, the region closest to the buyer, the organization id and the confirm cost id.
6. Call `get_project` every 30 seconds until its status is `ACTIVE_HEALTHY` (up to 5 minutes). A brand new project has nothing in it, so skip the check below and go to Step 3.

### Check for an earlier library

Call `execute_sql` on the chosen project with:

```sql
select
  exists (select 1 from information_schema.schemata where schema_name = 'youcloned') as has_schema,
  (select count(*) from information_schema.tables where table_schema = 'youcloned'
     and table_name in ('sources', 'chunks', 'wiki_pages', 'settings')) as library_tables,
  (select count(*) from information_schema.tables where table_schema = 'youcloned') as all_tables;
```

- `has_schema` is false: nothing is there yet. Go to Step 3.
- `library_tables` is 4: a library from an earlier setup is already in this project. Tell the buyer: "You already have a YouCloned library in this project. I'll keep everything in it and just bring it up to date." Then go on. Step 3 never deletes anything.
- Anything else (a `youcloned` section exists but it is not our library, or only part of it): stop. Tell the buyer: "This project already has a section called youcloned that I didn't make, so I won't touch it." Offer another of their projects or the free one (Path B).

Keep the project id for every step below.

## Step 3: Build the tables

Read `schema.sql` in this folder and call `apply_migration` with:

- `project_id`: the project id
- `name`: `youcloned_library`
- `query`: the whole file, exactly as it is

It is safe to run again later. It never deletes anything.

## Step 4: Put the library function online

Read `functions/library/index.ts` in this folder and call `deploy_edge_function` with:

- `project_id`: the project id
- `name`: `library`
- `entrypoint_path`: `index.ts`
- `verify_jwt`: `false` (the function checks its own token instead)
- `files`: one file, `name` `index.ts`, `content` the whole file exactly as it is

## Step 5: Make the token

1. Call `get_project_url` and keep the address it returns.
2. Run this on the buyer's computer (fill in this folder's path, the vault path and the address):
   - Mac: `python3 "<this folder>/make-token.py" "<vault>/.env" --project-url "<address>"`
   - Windows: `py -3 "<this folder>\make-token.py" "<vault>\.env" --project-url "<address>"` (use `python` if `py` is missing)
3. It saves two lines in the env file: `YOUCLONED_LIBRARY_TOKEN` and `YOUCLONED_LIBRARY_URL`. It keeps every other line.
4. It prints one line: 64 letters and digits. That is a fingerprint of the token, not the token, so it is safe to use in the next step.
5. If it says the env file is inside a git folder that does not ignore it, add a line `.env` to the `.gitignore` file at the top of the vault, then run it again.
   If it says the env file is tracked by git, stop and tell the buyer you need to take the env file out of their backup first.

Running it again keeps the same token. Only add `--new` when the buyer wants a fresh token (then do Step 6 again).

## Step 6: Save the fingerprint

Call `execute_sql` with the project id and this query, with the 64-character line from Step 5 in place of FINGERPRINT:

```sql
insert into youcloned.settings (k, v) values ('token_sha256', 'FINGERPRINT')
on conflict (k) do update set v = excluded.v;
```

## Step 7: Smoke test

Run:

- Mac: `python3 "<this folder>/smoke-test.py" "<vault>/.env"`
- Windows: `py -3 "<this folder>\smoke-test.py" "<vault>\.env"`

It adds a one-line note, searches for it, then removes it, and prints three lines that should all start with PASS.
The first run can take up to a minute while Supabase loads its search model.

If a line says FAIL:

- status 401: the fingerprint is not saved or does not match. Run Step 5 again (without `--new`), then Step 6.
- status 404: the function is not online. Do Step 4 again.
- status 500 or 546: look at the function's logs with the connector's log tool, fix what it says, and run the test again.
- status 0 with a certificate error on a Mac: follow the hint it prints, then run it again.

When all three pass, tell the buyer in one or two sentences that their library is ready and that next you will start feeding it.

## How the library is called

The librarian helper and any script call one address, `YOUCLONED_LIBRARY_URL` from the env file, always with POST,
a JSON body, and the header `x-library-token` set to `YOUCLONED_LIBRARY_TOKEN` from the env file (read in code, never shown).
Every reply is JSON. A problem comes back with `ok` set to false and an `error` line saying what went wrong.

| action | body | reply |
| --- | --- | --- |
| `ingest` | `source` (`kind`, `ref`, `title`, optional `happened_at`), `text` | `ok`, `source_id`, `chunks`, `words` |
| `search` | `query`, optional `k` (1 to 30, default 8), optional `kinds` | `results`: `title`, `kind`, `ref`, `content`, `score` |
| `wiki_upsert` | `slug`, `title`, `body` | `ok`, `slug`, `updated_at` |
| `wiki_get` | `slug` | `page` |
| `wiki_list` | nothing else | `pages` (no bodies) |
| `stats` | nothing else | `kinds` (count per kind), `sources`, `chunks`, `wiki_pages`, `last_added` |
| `forget` | `ref` | `forgotten` |

- `kind` is one of `email`, `web`, `youtube`, `doc`, `note`, `other`.
- `ref` is what makes a source unique: the page address, the email's message id, or the file path.
  Sending the same `ref` again replaces that source's text instead of adding a copy.
- `text` can be up to 400,000 characters a call (anything longer gets status 413). Long books or folders go in one file or section per call.
- The function cuts text into pieces of about 350 words, each overlapping the one before by about 50 words, and stores a meaning fingerprint for each piece.
- A wrong or missing token gets status 401.

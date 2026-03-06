# Shortcut → Linear Migration Tool

> **Disclaimer:** This tool was vibe coded. It was built fast, for a specific purpose, and used in production to migrate ~1,000 items. It works, but it is not a polished product. No guarantees on performance, edge-case handling, or de-duplication at scale. Use it, but keep an eye on it.

---

## What is this?

A local Next.js web app that migrates your team's data from [Shortcut](https://shortcut.com) to [Linear](https://linear.app) via their respective APIs. You run it locally, connect both accounts with API tokens, pick what to migrate, map your workflow states and members, preview the plan, then run it.

It was built because the native Linear import options didn't cover enough of the data we cared about preserving.

---

## How is this different from Linear's native Shortcut importer?

Linear has a [built-in Shortcut importer](https://linear.app/docs/import) that covers the core fields well. This tool was built to handle the things it doesn't.

| Feature | Linear importer | This tool |
|---|---|---|
| Stories → Issues | ✓ | ✓ |
| Title, description | ✓ | ✓ |
| Tasks → appended to description | ✓ | ✓ |
| External tickets → appended to description | ✓ | ✓ |
| State mapping | ✓ auto | ✓ manual (you control it) |
| Story type → label | ✓ | ✓ |
| Tags → labels | ✓ | ✓ |
| First owner → assignee | ✓ | ✓ |
| Comments | ✓ | ✓ with author name + original date |
| Estimate | ✓ | ✓ |
| Due date | ✓ | — |
| Priority | ✓ | — |
| Epics → Projects | ✓ | ✓ |
| **Milestones → Initiatives** | — | ✓ |
| **Iterations → Cycles** | — | ✓ |
| **Inline images re-hosted to Linear CDN** | — | ✓ |
| **Story file attachments uploaded to Linear CDN** | — | ✓ |
| **Comment file attachments uploaded to Linear CDN** | — | ✓ |
| **GitHub PR links as Linear attachments** | — | ✓ |
| **Linked files (Google Drive, Dropbox, etc.)** | — | ✓ |
| **Story relations (blocks / duplicates / relates to)** | — | ✓ |
| **Shortcut backlink on every issue** | — | ✓ |

If the native importer covers what you need, use it — it's more battle-tested. This tool exists for teams that need the bolded items above.

---

## What it does

1. **Connect** — enter your Shortcut and Linear API tokens (stored in memory only, never persisted)
2. **Select team** — pick the Shortcut team to migrate; see which teams already exist in Linear
3. **Browse & select** — choose which milestones, epics, iterations, and stories to include; items already in Linear are badged
4. **Configure mapping** — pick the target Linear team, map Shortcut workflow states to Linear statuses, and map Shortcut members to Linear users
5. **Preview** — review counts and spot-check the mapping before anything is written
6. **Run** — migration executes with a live log and results table; transient API errors are retried automatically; field validation failures fall back to progressively simpler payloads so issues are always created

---

## Re-running the migration

The tool is safe to run multiple times against the same team. On each run:

| Item | How it's detected | Behaviour |
|---|---|---|
| Initiative | Name match in Linear | Core fields updated (name, description, status, target date) |
| Project | Name match in Linear team | Core fields updated (name, description, state) |
| Issue | Shortcut backlink attachment on the Linear issue | Core fields updated (title, description, state, assignee, labels, estimate, project, cycle) |
| Issue with no backlink | Not found | Created fresh |

**What is not updated on re-run:** comments, file attachments, PR links, and story relations are skipped for existing issues — there is no way to deduplicate them and re-running would stack duplicates.

**Edge case:** if an issue was created but its Shortcut backlink attachment failed to save, the tool has no way to detect it and will create a duplicate on re-run.

---

## Caveats

- Tested on a migration of ~1,000 items (stories, epics, milestones, iterations). Larger datasets may hit Linear API rate limits.
- De-duplication on re-run relies on Shortcut backlink attachments being created successfully. If attachment creation fails for an issue, it may be created again on re-run.
- Linear has an 80-character limit on project and initiative names — long names are truncated with `…` and the full name is prepended to the description.
- Only the first Shortcut story owner becomes the Linear assignee.
- Story estimates are only migrated if they are positive integers that match the Linear team's estimate scale.

---

## Requirements

All you need are two API tokens — no database, no environment variables, no deployment required.

- A **Shortcut API token** — [Settings → API Tokens](https://app.shortcut.com/settings/api-tokens)
- A **Linear API token** — [Settings → API → Personal API keys](https://linear.app/settings/api)

Tokens are entered in the browser on first load and held in memory only for that session.

## Running locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and enter your tokens to get started.

# Backend — Butterbase + EverOS

Two systems, two jobs:
- **Butterbase** — structured system of record. Postgres tables + auto REST API + serverless functions. Owns: student profiles, session records, struggled words, tracing attempts, progress rollups.
- **EverOS** (EverMind) — semantic agent memory. Owns: turn-by-turn conversation ingestion + auto-extraction into searchable episodes/profiles/facts, so an LLM agent can ask "what has this student struggled with before" in natural language instead of re-reading raw transcripts.

Butterbase is also the **submission target** for this hackathon (`prep_and_submit_hackathon_entry` scores apps on `app_id` usage — database, functions, etc).

- **App ID**: `app_zuy5d3pu79m7`
- **API base**: `https://api.butterbase.ai/v1/app_zuy5d3pu79m7`
- **Access mode**: public (no auth yet — fine for the demo; tighten before anything real)
- **CORS**: allows `localhost:3000` and `localhost:5173` (+ 127.0.0.1 equivalents). If your dev server runs elsewhere, ask whoever owns the backend to update CORS.
- **EverOS API key**: lives only as an encrypted env var on the two Butterbase functions below. It is never sent to the frontend and must never be committed to this repo (including Poshitha's agent repo/submodule).

## Data model (Butterbase)

| Table | Purpose |
|---|---|
| `students` | Learner profile: `user_id`, `display_name`, `age`, `grade`, `notes` |
| `sentences` | Practice sentence bank: `text`, `topic` (e.g. "space", "animals"), `difficulty` |
| `practice_sessions` | One reading session: `student_id`, `sentence_id`, `session_label`, `session_type` (baseline/practice/reassessment/absence), `transcript`, `wpm`, `note`, `started_at`, `ended_at` |
| `session_messages` | Turn-by-turn log within a session: `session_id`, `role` (assistant/user), `content`, `message_timestamp` |
| `struggled_words` | Words flagged during a session: `session_id`, `student_id`, `word`, `syllable_count`, `error_type`, `attempt_duration_ms` (time spent before it was flagged — feeds the "which words take longer" timing requirement), `resolved` |
| `tracing_attempts` | CV letter-tracing practice for a struggled word: `struggled_word_id`, `student_id`, `letter_or_chunk`, `attempt_number`, `accuracy_score`, `duration_ms`, `completed` |
| `progress_snapshots` | Rolled-up progress summary: `student_id`, `period_label`, `wpm`, `persistent_bottlenecks`, `summary` |

The app is already seeded with a full 6-week sample arc for `leo_carter` (from `backend/datapack/leo_carter.json`) — useful for building/demoing the UI against real-shaped data before your own speech/CV pipeline is wired up.

## Two backend functions (the memory + integration layer)

Deployed at `POST {API_BASE}/fn/<name>`, no auth header required (public trigger) — call directly from the frontend or from Poshitha's agent code.

### `log-practice-session`
Dual-writes one completed session: structured rows into Butterbase (`practice_sessions`, `session_messages`, `struggled_words`) **and** the raw conversation into EverOS for semantic memory extraction. Call this once per finished sentence/practice round.

```js
await fetch(`${API_BASE}/fn/log-practice-session`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    student_id: "ffbdbb1d-...",       // students.id (uuid)
    student_user_id: "leo_carter",     // students.user_id — also the EverOS identity
    session_label: "session_2026_07_11_01",
    session_type: "practice",
    wpm: 62,
    note: "optional tutor/agent summary",
    messages: [
      { role: "assistant", content: "Let's try: The astronaut looked at the stars.", timestamp_ms: 1783700000000 },
      { role: "user", content: "the... as-tro-naut... looked at the stars", timestamp_ms: 1783700010000 },
    ],
    struggled_words: [
      { word: "astronaut", syllable_count: 3, error_type: "decoding_multisyllable", attempt_duration_ms: 4200 },
    ],
  }),
});
// -> { session_id, struggled_words: [{word, id}], everos_status: "ok" }
```

### `recall-memory`
Proxies EverOS's semantic search, scoped to one student. This is what Poshitha's agent calls to pull prior context (past struggles, what's worked) before deciding how to chunk a word or phrase a feedback prompt.

```js
await fetch(`${API_BASE}/fn/recall-memory`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ student_user_id: "leo_carter", query: "words Leo struggles to decode" }),
});
// -> { data: { episodes: [...], profiles: [...], raw_messages: [...] } }
```

**Important — EverOS does not auto-extract on write.** A raw write just "accumulates" until explicitly flushed, so `log-practice-session` calls EverOS's `/memories/flush` immediately after every write to force extraction. Even with that, extraction/indexing can lag a bit under load (confirmed: small 1-2 message sessions became searchable within seconds; a batch of six 5-7 message sessions took longer than a couple minutes to fully surface in search). If the agent needs the raw transcript *immediately* (not the extracted/summarized version), read `session_messages` from Butterbase directly instead of waiting on EverOS — that's always instant since it's a normal DB read.

## Current verified status (as of last backend session)

- Schema, seed data (Leo's 6-week arc), and `sentences` bank (8 space/animal sentences) — all live and confirmed via `select_rows`.
- `log-practice-session` and `recall-memory` — both live-tested against the real EverOS API (not just docs; docs were wrong/incomplete on required fields for both `/memories` and `/memories/search` — the code here reflects what the live API actually requires).
- Leo's original 6 sessions were backfilled into EverOS after the fact (they were originally bulk-seeded into Butterbase only, bypassing EverOS). Backfill write+flush calls all returned success; full search-surfacing of all 6 was not 100% confirmed within the test window due to indexing lag — worth a quick `recall-memory` sanity check before a live demo.
- No auth/RLS, functions have `auth: "none"` — deliberate for hackathon speed, revisit if this goes anywhere beyond the demo.

## Calling it from the frontend

Every table gets a free REST API. No auth header needed right now (public access mode).

```js
const API_BASE = "https://api.butterbase.ai/v1/app_zuy5d3pu79m7";

// List a student's sessions, most recent first
const res = await fetch(`${API_BASE}/practice_sessions?student_id=eq.${studentId}&order=started_at.desc`);
const sessions = await res.json();

// Log a new practice session
await fetch(`${API_BASE}/practice_sessions`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    student_id: studentId,
    session_label: "session_2026_07_11",
    session_type: "practice",
    transcript: "The astronaut looked at the stars.",
    wpm: 62,
  }),
});

// Flag a struggled word
await fetch(`${API_BASE}/struggled_words`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    session_id: sessionId,
    student_id: studentId,
    word: "astronaut",
    syllable_count: 3,
    error_type: "decoding_multisyllable",
  }),
});

// Log a letter-tracing (CV) attempt against a struggled word
await fetch(`${API_BASE}/tracing_attempts`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    struggled_word_id: struggledWordId,
    student_id: studentId,
    letter_or_chunk: "tro",
    attempt_number: 1,
    accuracy_score: 0.82,
    completed: true,
  }),
});
```

Filtering/sorting/pagination all work via query params, e.g.:
`GET /struggled_words?student_id=eq.<uuid>&resolved=eq.false&order=created_at.desc`

## Changing the schema

Whoever owns the backend should use the `manage_schema` Butterbase MCP tool (`action: "apply"`) rather than editing tables by hand — it diffs against the current schema and only runs the necessary DDL. Ping the backend owner (Kripa) before adding/dropping columns so seeded demo data doesn't break.

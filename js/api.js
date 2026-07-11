/* Domino — API adapter for the Agent lane (server.py in the team repo).
   Frozen contracts:
     POST /next    {learner, skill, session_n, last_resolved} -> activity
                   {sentence, tokens, target_word, syllables, target_chunk,
                    chunk_position, theme, prechunk, reason}
     POST /result  {stumble_word, failed_chunk, chunk_position, traced_correctly,
                    voiced_while_tracing, resolved, latency_ms}
                   -> {diagnosis, next_move, distill_skill, skill_text}
     POST /break   {word} -> {syllables, target_chunk, chunk_position}
   Every call tries the FastAPI server first and falls back to a mock that
   mirrors agent.py's mock mode, so the frontend demos identically offline.
   Point at the backend with ?api=http://localhost:8000 (default) or window.API_BASE. */

const API_BASE = (() => {
  const q = new URLSearchParams(location.search).get("api");
  return q || window.API_BASE || "http://localhost:8000";
})();

async function tryFetch(path, body, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(API_BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(res.status);
    return await res.json();
  } catch (e) {
    clearTimeout(t);
    console.warn(`[api] ${path} unavailable -> mock (${e.message})`);
    return null;
  }
}

/* Leo's learner blob (from the EverMind data pack) — sent in every /next call */
const LEARNER = {
  user_id: "leo_carter",
  display_name: "Leo Carter",
  age: 10,
  grade: "5th grade (reading, IEP)",
  interests: ["space", "rockets", "animals", "sea turtles"],
  baseline_wpm: 60,
  current_wpm: 65,
  notes: ["3+ syllable words are the persistent bottleneck (W2, W6)",
          "anxious in front of peers; thrives 1:1 (W3)"],
};

/* ---- mock content pack (mirrors content_pack.json) ---- */
const PACK = [
  { role: "demo_session1", theme: "space",
    sentence: "The astronaut floated past the window.",
    target_word: "astronaut", syllables: ["as", "tro", "naut"],
    target_chunk: "tro", chunk_position: "medial",
    reason: "3-syllable word; the medial consonant blend 'tro' is the likely break point." },
  { role: "demo_session2", theme: "space",
    sentence: "A giant asteroid raced toward the planet.",
    target_word: "asteroid", syllables: ["as", "ter", "oid"],
    target_chunk: "ter", chunk_position: "medial",
    reason: "Same pattern as astronaut: 3-syllable, hard medial chunk 'ter'." },
  { role: "curveball", theme: "animals",
    sentence: "The octopus hid behind a rock.",
    target_word: "octopus", syllables: ["oc", "to", "pus"],
    target_chunk: "to", chunk_position: "medial",
    reason: "Easier confidence-builder in a high-interest theme." },
];
const tokensOf = (s) => s.split(/\s+/).map((t) => t.replace(/^[^\w]+|[^\w]+$/g, ""));

function mockNext(memory) {
  const hasSkill = !!memory.skill;
  if (memory.last_resolved === false) {
    const it = PACK.find((p) => p.role === "curveball");
    return { ...it, tokens: tokensOf(it.sentence), prechunk: true,
      reason: it.reason + "  Easier word chosen because Leo didn't resolve the previous attempt." };
  }
  const it = PACK.find((p) => p.role === (memory.session_n <= 1 ? "demo_session1" : "demo_session2"));
  const prechunk = hasSkill && it.chunk_position === "medial";
  return { ...it, tokens: tokensOf(it.sentence), prechunk,
    reason: it.reason + (prechunk ? "  Pre-chunked up front because the agent already learned this pattern for Leo." : "") };
}
function mockDiagnose(r) {
  const chunk = r.failed_chunk || "?", pos = r.chunk_position || "medial";
  if (r.resolved) return {
    diagnosis: `Leo broke on the ${pos} chunk '${chunk}' but resolved it once the chunk was isolated and voiced while tracing.`,
    next_move: "Advance to another 3-syllable word with a hard medial chunk, and pre-chunk it.",
    distill_skill: true,
    skill_text: "Leo breaks on unfamiliar medial chunks (e.g. 'tro', 'ter'). Isolate and trace-plus-voice that chunk BEFORE the whole word. Never show the whole word first. No timer.",
  };
  return { diagnosis: `Leo did not resolve the ${pos} chunk '${chunk}'.`,
    next_move: "Drop to a 2-chunk version and switch to a high-interest word.",
    distill_skill: false, skill_text: null };
}

/* ---------------- public API ---------------- */
async function apiNext(memory) {
  return (await tryFetch("/next", memory)) || mockNext(memory);
}
async function apiResult(payload) {
  return (await tryFetch("/result", payload)) || mockDiagnose(payload);
}
async function apiBreak(word) {
  const real = await tryFetch("/break", { word });
  if (real) return real;
  const it = PACK.find((p) => p.target_word === word.toLowerCase());
  return it ? { syllables: it.syllables, target_chunk: it.target_chunk, chunk_position: it.chunk_position }
            : { syllables: [word], target_chunk: word, chunk_position: "medial" };
}

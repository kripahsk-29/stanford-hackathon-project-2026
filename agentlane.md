# Agent lane — Poshitha

The reasoning layer: picks the sentence, breaks the word into syllables + the failing chunk,
diagnoses each attempt, and flags when to distill a Skill. **Runs offline in mock mode** so you
build without waiting on anyone.

## Run it now (no API key)
```bash
python demo.py          # the full two-session arc, printed
```

## As a service (once Shlok/Kripa want to call you)
```bash
pip install fastapi uvicorn
uvicorn server:app --reload --port 8000
```

## Switch to a real model
```bash
pip install anthropic
export AGENT_MOCK=0
export ANTHROPIC_API_KEY=sk-...
export AGENT_MODEL=claude-sonnet-5      # or your Nebius / OpenAI-compatible model
```
Keep mock working — it's your **stage fallback** if the API flakes.

## Frozen contracts (do not change without telling Shlok + Kripa)
```
Memory  -> Agent    {"learner":{...}, "skill": str|null, "session_n": int}
Agent   -> Frontend {"sentence","tokens","target_word","syllables",
                     "target_chunk","chunk_position","theme","prechunk","reason"}
Frontend-> Memory   {"stumble_word","failed_chunk","chunk_position",
                     "traced_correctly","voiced_while_tracing","resolved","latency_ms"}
diagnosis           {"diagnosis","next_move","distill_skill","skill_text"}
```

## Integration
- **Shlok (frontend):** `POST /next` with the memory blob → render the returned activity.
  If `prechunk` is true, show the chunk split up front instead of the whole word first.
  After the attempt, `POST /result` with the Frontend→Memory JSON.
- **Kripa (memory):** the `/result` response has `distill_skill` + `skill_text` — write that into
  EverOS as the agent-side Skill, and pass `skill` back into the next `/next` call. That round-trip
  is what makes session 2 pre-empt the stumble.

## Files
- `content_pack.json` — 2 demo + 4 fallback sentences (CONFIRM syllables vs Leo's real file)
- `agent.py` — the lane (next_activity / break_word / diagnose)
- `demo.py` — the offline two-session arc
- `server.py` — HTTP surface

## The one thing to protect
The Skill round-trip (diagnose → Kripa writes → next_activity reads → `prechunk: true`).
That loop is the demo. Everything else is polish.
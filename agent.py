"""
Agent lane  --  Poshitha.
Reasoning layer for the read-aloud syllable tutor for Leo.

Contracts (frozen):
  IN   Memory  -> Agent     : {"learner": {...}, "skill": str|None, "session_n": int}
  OUT  Agent   -> Frontend  : {"sentence","tokens","target_word","syllables",
                               "target_chunk","chunk_position","theme","prechunk","reason"}
  IN   Frontend -> Memory   : {"stumble_word","failed_chunk","chunk_position",
                               "traced_correctly","voiced_while_tracing","resolved","latency_ms"}
  OUT  diagnosis            : {"diagnosis","next_move","distill_skill","skill_text"}

Runs in MOCK mode by default -- no API key, no waiting on teammates.
  Real model:  export AGENT_MOCK=0  and  export ANTHROPIC_API_KEY=...
  Swap provider: edit `agent_llm` (Nebius / OpenAI-compatible are one client change).
"""

import json, os, re, string
from pathlib import Path

USE_MOCK = os.environ.get("AGENT_MOCK", "1") != "0"
MODEL = os.environ.get("AGENT_MODEL", "claude-sonnet-4-6")
PACK = json.loads((Path(__file__).parent / "content_pack.json").read_text())


# ---------------------------------------------------------------------------
# PUBLIC API  (these three are what Shlok and Kripa call)
# ---------------------------------------------------------------------------
def next_activity(memory: dict) -> dict:
    """Memory -> Agent  ==>  Agent -> Frontend. Picks the next sentence/word to render."""
    session_n = int(memory.get("session_n", 1))
    has_skill = bool(memory.get("skill"))
    last_resolved = memory.get("last_resolved", True)  # Kripa sets False when resolved=false

    # Curveball: Leo didn't resolve → drop to an easier 2-chunk word for a confidence boost.
    if not last_resolved:
        cb = _find("curveball")
        item = cb[0] if cb else _find("fallback")[0]
        return {
            "sentence": item["sentence"],
            "tokens": _tokens(item["sentence"]),
            "target_word": item["target_word"],
            "syllables": item["syllables"],
            "target_chunk": item["target_chunk"],
            "chunk_position": item["chunk_position"],
            "theme": item["theme"],
            "prechunk": True,  # always pre-chunk the easier word
            "reason": item["reason"] + "  Easier word chosen because Leo didn't resolve the previous attempt.",
        }

    item = _find("demo_session1")[0] if session_n <= 1 else _find("demo_session2")[0]

    # Pre-chunk ONLY once the agent has learned Leo's medial-chunk pattern.
    prechunk = has_skill and item["chunk_position"] == "medial"

    return {
        "sentence": item["sentence"],
        "tokens": _tokens(item["sentence"]),
        "target_word": item["target_word"],
        "syllables": item["syllables"],
        "target_chunk": item["target_chunk"],
        "chunk_position": item["chunk_position"],
        "theme": item["theme"],
        "prechunk": prechunk,
        "reason": item["reason"] + (
            "  Pre-chunked up front because the agent already learned this pattern for Leo."
            if prechunk else ""),
    }


def break_word(word: str) -> dict:
    """Reliable pack lookup first; LLM fallback for novel words (the generalization story)."""
    for it in PACK["items"]:
        if it["target_word"].lower() == word.lower():
            return {"syllables": it["syllables"],
                    "target_chunk": it["target_chunk"],
                    "chunk_position": it["chunk_position"]}
    return agent_llm("break_word", {"word": word})


def diagnose(result: dict) -> dict:
    """Frontend -> Memory result  ==>  diagnosis + skill-distill flag for Kripa."""
    return agent_llm("diagnose", result)


# ---------------------------------------------------------------------------
# LLM helper  (mockable; real path guarded)
# ---------------------------------------------------------------------------
def agent_llm(task: str, payload: dict) -> dict:
    if USE_MOCK:
        return _mock(task, payload)
    try:
        import anthropic
        client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY
        system, user = _prompt(task, payload)
        msg = client.messages.create(
            model=MODEL, max_tokens=600, system=system,
            messages=[{"role": "user", "content": user}],
        )
        text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
        return _parse_json(text)
    except Exception as e:
        print(f"[agent_llm] real call failed ({e}) -> falling back to mock.")
        return _mock(task, payload)


def _prompt(task, payload):
    if task == "break_word":
        system = (
            "You are a reading-intervention agent for a child with dyslexia. Break the word into "
            "syllables and identify the SINGLE chunk the child is most likely to break on (usually "
            "an unfamiliar medial consonant blend). Return ONLY JSON, no prose: "
            '{"syllables": ["..."], "target_chunk": "...", "chunk_position": "initial|medial|final"}')
        return system, f'Word: {payload["word"]}'
    if task == "diagnose":
        system = (
            "You are a reading-intervention agent teaching ONE child (Leo, 10, dyslexia; breaks on "
            "unfamiliar medial chunks; anxiety when rushed). Given the result of one attempt, briefly "
            "diagnose it and decide the next move. Decide whether a reliable, repeatable teaching "
            "pattern has emerged worth saving as a durable Skill. Return ONLY JSON, no prose: "
            '{"diagnosis": "...", "next_move": "...", "distill_skill": true|false, "skill_text": "..."|null}')
        return system, json.dumps(payload)
    raise ValueError(task)


# ---------------------------------------------------------------------------
# MOCK  (deterministic -- powers the offline demo AND is your stage fallback)
# ---------------------------------------------------------------------------
def _mock(task, payload):
    if task == "break_word":
        w = payload["word"]
        return {"syllables": [w], "target_chunk": w, "chunk_position": "medial"}
    if task == "diagnose":
        chunk = payload.get("failed_chunk", "?")
        pos = payload.get("chunk_position", "medial")
        if payload.get("resolved"):
            return {
                "diagnosis": (f"Leo broke on the {pos} chunk '{chunk}' but resolved it once the chunk "
                              f"was isolated and voiced while tracing. Fits the unfamiliar-medial-chunk pattern."),
                "next_move": "Advance to another 3-syllable word with a hard medial chunk, and pre-chunk it.",
                "distill_skill": True,
                "skill_text": ("Leo breaks on unfamiliar medial chunks (e.g. 'tro', 'ter'). Isolate and "
                               "trace-plus-voice that chunk BEFORE the whole word. Never show the whole word first. No timer."),
            }
        return {
            "diagnosis": f"Leo did not resolve the {pos} chunk '{chunk}'.",
            "next_move": "Drop to a 2-chunk version and switch to a high-interest word.",
            "distill_skill": False, "skill_text": None,
        }
    raise ValueError(task)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def _tokens(sentence):
    return [t.strip(string.punctuation) for t in sentence.split()]

def _find(role):
    return [it for it in PACK["items"] if it["role"] == role]

def _parse_json(text):
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text).strip()
    return json.loads(text)
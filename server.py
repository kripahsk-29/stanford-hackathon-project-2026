"""
HTTP surface for the Agent lane.
  pip install fastapi uvicorn
  uvicorn server:app --reload --port 8000

Endpoints:
  POST /next    body = Memory->Agent JSON   -> returns Agent->Frontend activity   (Kripa/Shlok call this)
  POST /result  body = Frontend->Memory JSON-> returns diagnosis + skill flag      (Shlok/Kripa call this)
  POST /break   body = {"word": "..."}       -> returns syllable/chunk breakdown    (optional)
  GET  /health
"""
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

# Load .env if present (keeps API key out of shell history and GitHub)
_env = Path(__file__).parent / ".env"
if _env.exists():
    for _line in _env.read_text().splitlines():
        if _line.strip() and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            import os; os.environ.setdefault(_k.strip(), _v.strip())

from agent import next_activity, diagnose, break_word

app = FastAPI(title="Leo Reading Tutor -- Agent lane")

# let the browser frontend hit us during the hackathon
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.post("/next")
async def next_(req: Request):
    return next_activity(await req.json())


@app.post("/result")
async def result_(req: Request):
    return diagnose(await req.json())


@app.post("/break")
async def break_(req: Request):
    return break_word((await req.json())["word"])


@app.get("/health")
async def health():
    return {"ok": True}
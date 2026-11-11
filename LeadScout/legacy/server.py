import os

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from agent import run_agent

app = FastAPI(title="LeadScout")


class RunRequest(BaseModel):
    query: str
    base_url: str = ""
    api_key: str = ""
    model: str = ""


@app.post("/api/run")
def run(req: RunRequest):
    query = req.query.strip()
    if not query:
        raise HTTPException(400, "Query khaali hai.")

    cfg = {
        "base_url": req.base_url.strip() or os.getenv("LLM_BASE_URL", "https://api.openai.com/v1"),
        "api_key": req.api_key.strip() or os.getenv("LLM_API_KEY", ""),
        "model": req.model.strip() or os.getenv("LLM_MODEL", "gpt-4o-mini"),
    }
    if not cfg["api_key"]:
        raise HTTPException(400, "API key dein (form mein ya LLM_API_KEY env var mein).")

    try:
        answer, logs = run_agent(query, cfg)
    except Exception as e:
        raise HTTPException(500, str(e))
    return {"answer": answer, "logs": logs}


# Website files (index.html) served at /
app.mount("/", StaticFiles(directory=os.path.join(os.path.dirname(__file__), "static"), html=True), name="static")

"""LeadScout agent: OpenAI-compatible LLM + web_search / web_fetch tools.

Works with any OpenAI-compatible chat endpoint (OpenAI, OpenRouter, Groq,
Together, local Ollama/vLLM, etc.). Set base URL, API key and model in the
website form, or via env vars LLM_BASE_URL, LLM_API_KEY, LLM_MODEL.
"""
import html
import json
import os
import re
from urllib.parse import parse_qs, urlparse

import httpx

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "system_prompt.md"), encoding="utf-8") as f:
    SYSTEM_PROMPT = f.read()

MAX_STEPS = 12
HEADERS = {"User-Agent": "Mozilla/5.0 (LeadScout research agent; public pages only)"}


def _clean_text(raw: str) -> str:
    raw = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", raw)
    raw = re.sub(r"(?s)<[^>]+>", " ", raw)
    raw = html.unescape(raw)
    return re.sub(r"\s+", " ", raw).strip()


def web_search(query: str) -> str:
    """Search DuckDuckGo's HTML endpoint (no API key needed)."""
    r = httpx.get(
        "https://html.duckduckgo.com/html/",
        params={"q": query},
        headers=HEADERS,
        timeout=20,
        follow_redirects=True,
    )
    r.raise_for_status()
    items = re.findall(
        r'<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>'
        r'.*?<a[^>]*class="result__snippet"[^>]*>(.*?)</a>',
        r.text,
        re.S,
    )
    if not items:
        return "No results."
    lines = []
    for i, (href, title, snippet) in enumerate(items[:8], 1):
        url = href
        if "uddg=" in href:  # DDG redirect wrapper
            qs = parse_qs(urlparse("https:" + href if href.startswith("//") else href).query)
            url = qs.get("uddg", [href])[0]
        lines.append(f"{i}. {_clean_text(title)}\n   {url}\n   {_clean_text(snippet)}")
    return "\n".join(lines)


def web_fetch(url: str) -> str:
    """Fetch a public http(s) page and return readable text (truncated)."""
    if urlparse(url).scheme not in ("http", "https"):
        return "ERROR: only http(s) URLs are allowed."
    r = httpx.get(url, headers=HEADERS, timeout=20, follow_redirects=True)
    r.raise_for_status()
    text = _clean_text(r.text)
    return text[:6000] + (" ...[truncated]" if len(text) > 6000 else "")


TOOL_FUNCS = {"web_search": web_search, "web_fetch": web_fetch}

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search the public web. Returns top results with title, url and snippet. Use site: operators for specific platforms.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "web_fetch",
            "description": "Fetch one public http(s) URL and return its readable text. Only use URLs returned by web_search or given by the user.",
            "parameters": {
                "type": "object",
                "properties": {"url": {"type": "string"}},
                "required": ["url"],
            },
        },
    },
]


def _chat(cfg: dict, messages: list) -> dict:
    url = cfg["base_url"].rstrip("/") + "/chat/completions"
    r = httpx.post(
        url,
        headers={"Authorization": f"Bearer {cfg['api_key']}"},
        json={
            "model": cfg["model"],
            "messages": messages,
            "tools": TOOLS,
            "tool_choice": "auto",
        },
        timeout=180,
    )
    if r.status_code >= 400:
        raise RuntimeError(f"LLM API error {r.status_code}: {r.text[:500]}")
    return r.json()


def run_agent(query: str, cfg: dict) -> tuple[str, list[str]]:
    """Run the tool-calling loop. Returns (final answer, progress log)."""
    logs: list[str] = []
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": query},
    ]
    for _ in range(MAX_STEPS):
        data = _chat(cfg, messages)
        msg = data["choices"][0]["message"]
        messages.append(msg)
        calls = msg.get("tool_calls") or []
        if not calls:
            return (msg.get("content") or "").strip(), logs
        for call in calls:
            name = call["function"]["name"]
            try:
                args = json.loads(call["function"].get("arguments") or "{}")
                logs.append(f"{name}({json.dumps(args, ensure_ascii=False)})")
                func = TOOL_FUNCS.get(name)
                out = func(**args) if func else f"ERROR: unknown tool {name}"
            except Exception as e:  # keep the loop alive on tool errors
                out = f"ERROR: {e}"
                logs.append(out)
            messages.append(
                {"role": "tool", "tool_call_id": call["id"], "content": str(out)[:8000]}
            )
    return "Step limit reached. Query ko chhota karke dobara try karein.", logs

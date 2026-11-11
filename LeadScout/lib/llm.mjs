/**
 * LLM client — OpenAI-compatible only (OpenAI, OpenRouter, Groq, DeepSeek,
 * Together, Ollama, vLLM, LM Studio all speak this).
 *
 * The LLM never invents leads. It only (a) refines search queries, (b) writes
 * the project pitch, (c) writes outreach copy. Every fact it is given comes
 * from a source record we already fetched.
 */

const DEFAULTS = {
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
};

export async function chat(cfg, messages, { maxTokens = 1200, temperature = 0.4, timeout = 90000 } = {}) {
  if (!cfg?.apiKey) throw new Error("no LLM key");
  const base = (cfg.baseUrl || DEFAULTS.baseUrl).replace(/\/+$/, "");
  const url = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model || DEFAULTS.model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(timeout),
  });

  if (!r.ok) {
    const body = (await r.text()).slice(0, 300);
    throw new Error(`LLM ${r.status}: ${body}`);
  }
  const data = await r.json();
  return data?.choices?.[0]?.message?.content?.trim() || "";
}

/** Ask for strict JSON, tolerate markdown fences, retry once on parse failure. */
export async function chatJSON(cfg, system, user, opts = {}) {
  const messages = [
    { role: "system", content: `${system}\n\nReply with valid JSON only. No prose, no markdown fences.` },
    { role: "user", content: user },
  ];
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await chat(cfg, messages, { temperature: 0.3, ...opts });
    last = raw;
    const parsed = parseJsonLoose(raw);
    if (parsed) return parsed;
    messages.push({ role: "assistant", content: raw });
    messages.push({ role: "user", content: "That was not valid JSON. Return only the JSON object." });
  }
  throw new Error(`unparseable JSON from model: ${last.slice(0, 160)}`);
}

export function parseJsonLoose(raw = "") {
  const s = String(raw).trim();
  const tryParse = (t) => {
    try {
      return JSON.parse(t);
    } catch {
      return null;
    }
  };
  let v = tryParse(s);
  if (v) return v;
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    v = tryParse(fence[1].trim());
    if (v) return v;
  }
  const starts = [...s.matchAll(/[[{]/g)].map((m) => m.index);
  for (const i of starts) {
    const slice = s.slice(i);
    // try progressively shorter suffixes at brace boundaries
    for (let end = slice.length; end > 8; end--) {
      if (!/[\]}]/.test(slice[end - 1])) continue;
      v = tryParse(slice.slice(0, end));
      if (v) return v;
    }
  }
  return null;
}

export async function checkLLM(cfg) {
  const out = await chat(
    { ...cfg, model: cfg.model || DEFAULTS.model },
    [{ role: "user", content: "Reply with the single word: ok" }],
    { maxTokens: 8, timeout: 30000 }
  );
  return out.slice(0, 40);
}

export const LLM_PRESETS = [
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini" },
  { id: "groq", label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { id: "together", label: "Together", baseUrl: "https://api.together.xyz/v1", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
  { id: "ollama", label: "Ollama (local)", baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.1" },
];

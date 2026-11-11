// Minimal CDP probe: verifies the rendered state of the app (classes, computed
// opacity, console errors) without a full browser automation dependency.
const PORT = process.env.CDP_PORT || 9223;
const URL_ = process.env.APP_URL || "http://127.0.0.1:8787/#settings";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let targets = [];
  for (let i = 0; i < 20; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      targets = await r.json();
      if (targets.some((t) => t.type === "page")) break;
    } catch {}
    await sleep(500);
  }
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("no page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  const consoleErrors = [];
  let id = 0;

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const msgId = ++id;
      pending.set(msgId, { resolve, reject });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });

  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method === "Runtime.exceptionThrown") {
      consoleErrors.push(msg.params.exceptionDetails?.exception?.description || "exception");
    } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      consoleErrors.push(msg.params.args.map((a) => a.value || a.description).join(" "));
    }
  });

  await new Promise((r) => ws.addEventListener("open", r));
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.navigate", { url: URL_ });
  await sleep(3500);

  const evalExpr = async (expr) => {
    const res = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
    return res.result?.value;
  };

  const report = await evalExpr(`(() => {
    const nav = document.querySelector('.nav-item.active');
    const view = document.querySelector('.view.active');
    const cs = view ? getComputedStyle(view) : null;
    return {
      navActive: nav ? nav.dataset.view : null,
      viewActive: view ? view.id : null,
      viewOpacity: cs ? cs.opacity : null,
      viewAnimation: cs ? cs.animationName : null,
      bodyClass: document.body.className,
      leadCards: document.querySelectorAll('.lead-card').length,
      kpis: [...document.querySelectorAll('.kpi b')].map(e => e.textContent),
      headline: document.querySelector('h1')?.textContent?.slice(0, 40),
      chips: document.querySelectorAll('#serviceChips .chip').length,
    };
  })()`);

  console.log(JSON.stringify({ report, consoleErrors }, null, 2));
  ws.close();
}

main().catch((e) => {
  console.error("probe failed:", e.message);
  process.exit(1);
});

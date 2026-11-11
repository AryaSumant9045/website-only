// Reliable screenshot via CDP (headless --screenshot can capture a stale layer).
//   node scripts/shot.mjs <url> <out.png> [waitMs]
import { writeFile } from "node:fs/promises";

const PORT = process.env.CDP_PORT || 9223;
const url = process.argv[2] || "http://127.0.0.1:8787/";
const out = process.argv[3] || "shot.png";
const wait = Number(process.argv[4] || 3000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page");
if (!page) throw new Error("no page target");

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(m.error.message)) : resolve(m.result);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

await new Promise((r) => ws.addEventListener("open", r));
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: "about:blank" });
await sleep(300);
await send("Page.navigate", { url });
await sleep(wait);

// Optional JS to run before the capture (e.g. open a modal by clicking a button).
const before = process.argv[5];
if (before) {
  await send("Runtime.evaluate", { expression: before, awaitPromise: true });
  await sleep(600);
}
const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
await writeFile(out, Buffer.from(data, "base64"));
console.log(`saved ${out}`);
ws.close();

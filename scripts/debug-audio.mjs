#!/usr/bin/env node
/**
 * Debug probe: runs the demo at a given speed in headless Chrome and prints
 * audio-clock + transcript progression every 3 seconds.
 *
 * Usage: node scripts/debug-audio.mjs [baseUrl] [speed]
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const CHROME = process.env.CHROME_BIN ?? "/home/kiter/.local/bin/google-chrome";
const PORT = 9700 + Math.floor(Math.random() * 200);
const BASE = process.argv[2] ?? "http://localhost:5173";
const SPEED = process.argv[3] ?? "0.5";
const sessionId = `probe-${Date.now().toString(36)}`;

const profile = mkdtempSync(join(tmpdir(), "rakshak-probe-"));
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--no-sandbox",
    "--disable-gpu",
    "--autoplay-policy=no-user-gesture-required",
    "--mute-audio",
    "--no-first-run",
    "--disable-dev-shm-usage",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    `${BASE}/call/${sessionId}?speed=${SPEED}`
  ],
  { stdio: "ignore" }
);

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let id = 0;
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    };
    ws.onerror = reject;
    ws.onopen = () =>
      resolve({
        send: (method, params = {}) =>
          new Promise((res) => {
            const mid = ++id;
            pending.set(mid, (msg) => res(msg.result));
            ws.send(JSON.stringify({ id: mid, method, params }));
          }),
        close: () => ws.close()
      });
  });
}

async function main() {
  let target = null;
  for (let i = 0; i < 50 && !target; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === "page" && t.url.includes("/call/"));
    } catch {
      // retry
    }
    if (!target) await delay(400);
  }
  if (!target) throw new Error("no target");
  const { send, close } = await connect(target.webSocketDebuggerUrl);
  await send("Runtime.enable");
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    return result?.result?.value;
  };
  for (let i = 0; i < 40; i += 1) {
    const ready = await evaluate(`!!Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Play the scam call'))`);
    if (ready) break;
    await delay(400);
  }
  await evaluate(`(() => { const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('Play the scam call')); b.click(); })()`);
  const withShots = process.env.SHOTS === '1';
  let shotCount = 0;
  if (withShots) {
    setInterval(async () => {
      try { await send('Page.captureScreenshot', { format: 'jpeg', quality: 60 }); shotCount += 1; } catch {}
    }, 250);
  }
  const start = Date.now();
  while (Date.now() - start < 150000) {
    const audio = await evaluate(`window.__rakshakAudio ? window.__rakshakAudio() : null`);
    const state = await evaluate(`(() => { const s = window.__rakshak; return s ? { status: s.status, peak: Math.round(s.peakSeverity), u: s.utterances.length, last: s.utterances.at(-1)?.text?.slice(0, 60), err: s.pipeline.filter(l=>l.status==='error').length } : null; })()`);
    console.log(
      `${((Date.now() - start) / 1000).toFixed(0)}s`,
      audio ? `audio=${audio.currentTime.toFixed(1)}/${audio.duration.toFixed(0)}${audio.paused ? " PAUSED" : ""}${audio.ended ? " ENDED" : ""}` : "audio=n/a",
      state ? `peak=${state.peak} u=${state.u} err=${state.err} | ${state.last}` : ""
    );
    if (state?.status === "ended") break;
    await delay(3000);
  }
  close();
  chrome.kill("SIGKILL");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  chrome.kill("SIGKILL");
  process.exit(1);
});

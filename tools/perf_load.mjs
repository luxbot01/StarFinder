// First-load time on a throttled phone profile, so a change to the load can be measured before and after.
// Usage: node tools/perf_load.mjs [url] [runs]    default url: the live site; runs: 5 measured after 1 warm-up (cold cache every time)
// Profile (the one StarfinderContext V6 names): Chromium, 390x844 at 3x, touch, CDP network 10 Mbit/s down with 60 ms
// latency, and a 4x CPU slowdown. Per run: the time to the list (first place row in the DOM), to the map (state.mapReady),
// the first and largest contentful paint, the load event, and every byte that crossed the network, with the biggest
// requests named. The median of the runs is printed; one run is noise.
import { createRequire } from "module";
const require = createRequire("C:/Users/luxbo/Documents/Code/sage-desktop/package.json");
const { chromium } = require("playwright");
const URL = process.argv[2] || "https://luxbot01.github.io/StarFinder/StarFinder.html";
const RUNS = +(process.argv[3] || 5);   // measured runs; one extra warm-up run comes first and is thrown away (the first load of a session is always slower)
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const browser = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu"] });
const runs = [];
for (let i = -1; i < RUNS; i++) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable"); await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 60, downloadThroughput: (10 * 1024 * 1024) / 8, uploadThroughput: (10 * 1024 * 1024) / 8 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const reqs = new Map();
  cdp.on("Network.requestWillBeSent", (e) => reqs.set(e.requestId, { url: e.request.url, t0: e.timestamp, bytes: 0 }));
  cdp.on("Network.loadingFinished", (e) => { const r = reqs.get(e.requestId); if (r) { r.bytes = e.encodedDataLength; r.t1 = e.timestamp; } });
  await page.addInitScript(() => {
    window.__perf = { list: null, map: null, lcp: 0, fcp: null };
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === "first-contentful-paint") window.__perf.fcp = e.startTime; }).observe({ type: "paint", buffered: true });
    const tick = () => {
      if (window.__perf.list == null && document.querySelector(".row")) window.__perf.list = performance.now();
      if (window.__perf.map == null && window.__sf && window.__sf.mapReady) window.__perf.map = performance.now();
      if (window.__perf.list == null || window.__perf.map == null) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.goto("about:blank");
  await page.goto(URL, { waitUntil: "load", timeout: 120000 });
  await page.waitForFunction(() => window.__perf && window.__perf.list != null && window.__perf.map != null, null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const m = await page.evaluate(() => ({ ...window.__perf, load: performance.timing.loadEventEnd - performance.timing.navigationStart }));
  const all = [...reqs.values()].filter((r) => r.bytes);
  const total = all.reduce((s, r) => s + r.bytes, 0);
  const top = all.sort((a, b) => b.bytes - a.bytes).slice(0, 6).map((r) => `${Math.round(r.bytes / 1024)} KB ${r.url.replace(/^https?:\/\//, "").slice(0, 70)}`);
  if (i >= 0) runs.push({ ...m, requests: reqs.size, kb: Math.round(total / 1024), top });
  await ctx.close();
}
await browser.close();
const f = (k) => Math.round(med(runs.map((r) => r[k] ?? NaN)));
console.log(`${URL}\n${RUNS} cold runs, 10 Mbit/s, 60 ms, 4x CPU, 390x844@3`);
console.log(`MEDIAN  list ${f("list")} ms | map ready ${f("map")} ms | FCP ${f("fcp")} ms | LCP ${f("lcp")} ms | load ${f("load")} ms | ${f("requests")} requests | ${f("kb")} KB`);
console.log("each run: " + runs.map((r) => `[list ${Math.round(r.list)} map ${Math.round(r.map)} lcp ${Math.round(r.lcp)} ${r.kb}KB]`).join(" "));
console.log("biggest requests (last run):\n  " + runs[runs.length - 1].top.join("\n  "));

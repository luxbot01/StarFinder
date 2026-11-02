// The forecast and the glass search, checked in Chromium and WebKit at every size we ship for.
// Usage: node tools/shoot_wx.mjs <outDir> [viewPrefix]   (the site served at http://127.0.0.1:4317)
// Per view: console and page errors, failed requests, the search capsule's measurements, the card's seven days
// (desktop) or the pop-up's strip then the card (touch), sideways overflow, and screenshots to look at.
import { createRequire } from "module";
const require = createRequire("C:/Users/luxbo/Documents/Code/sage-desktop/package.json");
const { chromium, webkit } = require("playwright");
const fs = await import("fs");
const OUT = process.argv[2] || "C:/Users/luxbo/Documents/Code/StarFinder/docs/screens/wx";
const only = process.argv[3] || "";
const BASE = "http://127.0.0.1:4317/StarFinder.html";
const PLACE = "tx-enchanted-rock";
fs.mkdirSync(OUT, { recursive: true });
const views = [
  ["desktop-1440", 1440, 900, 1, false], ["desktop-1920", 1920, 1080, 1, false], ["ultrawide-2560", 2560, 1080, 1, false],
  ["laptop-1180", 1180, 820, 1.5, false], ["portrait-monitor-1080", 1080, 1920, 1, false],
  ["phone-390", 390, 844, 3, true], ["phone-430", 430, 932, 3, true], ["fold-cover-344", 344, 882, 2.625, true],
  ["fold-inner-673", 673, 841, 2.625, true], ["fold-inner-land-841", 841, 673, 2.625, true],
  ["phone-land-844", 844, 390, 3, true], ["tablet-768", 768, 1024, 2, true], ["small-phone-360", 360, 640, 3, true],
];
const report = [];
const settle = (page) => page.waitForFunction(() => {
  const els = [...document.querySelectorAll(".wx")]; return els.length && els.every((e) => !e.hasAttribute("aria-busy"));
}, null, { timeout: 25000 }).catch(() => "timeout");

for (const [engineName, engine] of [["chromium", chromium], ["webkit", webkit]]) {
  const browser = await engine.launch(engineName === "chromium" ? { args: ["--use-angle=d3d11", "--enable-gpu"] } : {});
  for (const [name, w, h, dpr, touch] of views) {
    if (only && !name.startsWith(only)) continue;
    if (engineName === "webkit" && !touch && !name.startsWith("desktop-1440")) continue;
    if (process.env.ENGINE && process.env.ENGINE !== engineName) continue;   // WebKit: every touch size, one desktop
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: touch, isMobile: touch && engineName === "chromium" });
    const page = await ctx.newPage(); const errs = [], bad = [], wxReq = [];
    page.on("pageerror", (e) => errs.push("pageerror: " + String(e).slice(0, 180)));
    page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 180)); });
    page.on("response", (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url().slice(0, 120)}`); });
    page.on("requestfailed", (r) => bad.push(`failed ${r.url().slice(0, 120)} ${r.failure() && r.failure().errorText}`));
    page.on("request", (r) => { if (/weather\.gov|open-meteo/.test(r.url())) wxReq.push(r.url().replace(/\?.*/, "?..")); });
    const tag = `${engineName}-${name}`;
    try {
    await page.goto("about:blank"); await page.goto(BASE, { waitUntil: "load" }); await page.waitForTimeout(5500);
    const search = await page.evaluate(() => {
      const s = document.querySelector(".search"), i = document.querySelector("#q"), g = document.querySelector("#qGo"), b = document.querySelector("#burger");
      const r = (e) => { const x = e.getBoundingClientRect(); return { w: Math.round(x.width), h: Math.round(x.height), x: Math.round(x.left), y: Math.round(x.top) }; };
      return { cap: r(s), go: r(g), burger: getComputedStyle(b).display === "none" ? null : r(b), inputFont: getComputedStyle(i).fontSize,
        backdrop: getComputedStyle(s).backdropFilter || getComputedStyle(s).webkitBackdropFilter, radius: getComputedStyle(s).borderRadius };
    });
    await page.screenshot({ path: `${OUT}/${tag}-1-map.png` });
    await page.focus("#q"); await page.keyboard.type("enchanted"); await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${tag}-2-search.png` });
    let mini = null;
    if (touch && w < 900) {
      await page.click(`.row[data-id="${PLACE}"]`); await page.waitForTimeout(1600); await settle(page); await page.waitForTimeout(300);
      mini = await page.evaluate(() => { const m = document.querySelector(".pop .wx"); if (!m) return null;
        const lis = [...m.querySelectorAll(".wx-day")]; return { days: lis.length, overflow: lis.filter(((l) => [...l.children].some((k) => !k.classList.contains('wx-mark') && !k.classList.contains('sr-only') && (k.getBoundingClientRect().right > l.getBoundingClientRect().right + 0.5 || k.getBoundingClientRect().left < l.getBoundingClientRect().left - 0.5)))).length,
          src: (m.querySelector(".wx-src") || m).textContent.trim().slice(0, 90), popW: Math.round(document.querySelector(".pop").getBoundingClientRect().width),
          popBottom: Math.round(document.querySelector(".pop").getBoundingClientRect().bottom) }; });
      await page.screenshot({ path: `${OUT}/${tag}-3-pop.png` });
      const det = await page.$(".pop [data-details]"); if (det) await det.click();
    } else {
      await page.click(`.row[data-id="${PLACE}"]`); await page.waitForTimeout(2600); await settle(page);   // desktop: card, then the pop-up
      mini = await page.evaluate(() => { const m = document.querySelector(".pop .wx"); return m ? { days: m.querySelectorAll(".wx-day").length,
        overflow: [...m.querySelectorAll(".wx-day")].filter(((l) => [...l.children].some((k) => !k.classList.contains('wx-mark') && !k.classList.contains('sr-only') && (k.getBoundingClientRect().right > l.getBoundingClientRect().right + 0.5 || k.getBoundingClientRect().left < l.getBoundingClientRect().left - 0.5)))).length, popW: Math.round(document.querySelector(".pop").getBoundingClientRect().width),
        popBottom: Math.round(document.querySelector(".pop").getBoundingClientRect().bottom), src: (m.querySelector(".wx-src") || m).textContent.trim().slice(0, 90) } : null; });
      await page.screenshot({ path: `${OUT}/${tag}-3-pop.png` });
    }
    await page.waitForTimeout(1800); await settle(page); await page.waitForTimeout(400);
    // the card scrolled to its forecast, so the screenshot shows the week
    await page.evaluate(() => { const c = document.querySelector("#wxCard"); if (c) c.scrollIntoView({ block: "center" }); });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/${tag}-4-card.png` });
    const card = await page.evaluate(() => {
      const c = document.querySelector("#wxCard"); if (!c) return null;
      const lis = [...c.querySelectorAll(".wx-day")];
      return { days: lis.length, kinds: lis.map((l) => l.dataset.kind || "wait").join(","), overflow: lis.filter(((l) => [...l.children].some((k) => !k.classList.contains('wx-mark') && !k.classList.contains('sr-only') && (k.getBoundingClientRect().right > l.getBoundingClientRect().right + 0.5 || k.getBoundingClientRect().left < l.getBoundingClientRect().left - 0.5)))).length,
        colW: lis[0] ? Math.round(lis[0].getBoundingClientRect().width) : 0, night: (c.querySelector(".wx-night") || {}).textContent || "",
        src: ((c.querySelector(".wx-src") || c.querySelector(".wx-msg") || {}).textContent || "").trim().slice(0, 120),
        sr: (c.querySelector(".wx-day .sr-only") || {}).textContent || "" };
    });
    const sw = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
    report.push({ tag, search, mini, card, ...sw, wxRequests: wxReq.length, errors: errs.slice(0, 6), badResponses: bad.length, bad: bad.slice(0, 4) });
    } catch (e) {   // a harness failure is recorded and photographed, never skipped silently
      report.push({ tag, harnessError: String(e).split(String.fromCharCode(10))[0].slice(0, 200), errors: errs.slice(0, 6), badResponses: bad.length, search: {}, wxRequests: wxReq.length });
      await page.screenshot({ path: `${OUT}/${tag}-x-failed.png` }).catch(() => {});
    }
    await ctx.close();
  }
  await browser.close();
}
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report.map((r) => ({ tag: r.tag, fail: r.harnessError, cap: r.search.cap, go: r.search.go, burger: r.search.burger, font: r.search.inputFont,
  mini: r.mini && `${r.mini.days}d ov${r.mini.overflow} w${r.mini.popW} b${r.mini.popBottom}`, card: r.card && `${r.card.days}d ov${r.card.overflow} col${r.card.colW} ${r.card.kinds}`,
  sw: `${r.sw}/${r.iw}`, req: r.wxRequests, errs: r.errors.length, bad: r.badResponses })), null, 0).replace(/\},\{/g, "},\n{"));

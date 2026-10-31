// Screenshot StarFinder at phone, fold, landscape, tablet and desktop sizes, in Chromium and WebKit.
import { createRequire } from "module";
const require = createRequire("C:/Users/luxbo/Documents/Code/sage-desktop/package.json");
const { chromium, webkit } = require("playwright");
const OUT = process.argv[2] || "C:/Users/luxbo/Documents/Code/StarFinder/docs/screens";
const BASE = "http://127.0.0.1:4317/StarFinder.html";
const only = process.argv[3] || "";
const views = [
  ["desktop-1440", 1440, 900, 1, false], ["desktop-1920", 1920, 1080, 1, false],
  ["phone-390", 390, 844, 3, true], ["fold-cover-344", 344, 882, 2.625, true], ["fold-inner-673", 673, 841, 2.625, true],
  ["phone-land-844", 844, 390, 3, true], ["tablet-768", 768, 1024, 2, true],
];
const fs = await import("fs"); fs.mkdirSync(OUT, { recursive: true });
const report = [];
for (const [engineName, engine] of [["chromium", chromium], ["webkit", webkit]]) {
  const browser = await engine.launch(engineName === "chromium" ? { args: ["--use-angle=d3d11", "--enable-gpu"] } : {});
  for (const [name, w, h, dpr, touch] of views) {
    if (only && !name.startsWith(only)) continue;
    if (engineName === "webkit" && !touch) continue;              // WebKit is the iPhone engine: phones and tablets only
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: touch, isMobile: touch && engineName === "chromium" });
    const page = await ctx.newPage(); const errs = [];
    page.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 160)); });
    await page.goto("about:blank"); await page.goto(BASE, { waitUntil: "load" });
    await page.waitForTimeout(6500);
    const tag = `${engineName}-${name}`;
    const m = await page.evaluate(() => ({ rows: document.querySelectorAll(".row").length, sw: document.documentElement.scrollWidth, iw: innerWidth,
      mapCanvas: !!document.querySelector(".maplibregl-canvas"), count: document.querySelector("#count").textContent }));
    await page.screenshot({ path: `${OUT}/${tag}-1-map.png` });
    if (touch && w < 900) { await page.click("#burger"); await page.waitForTimeout(500); await page.screenshot({ path: `${OUT}/${tag}-2-list.png` }); await page.click("#burger"); }
    await page.evaluate(() => { location.hash = "#p=tx-enchanted-rock"; });
    await page.reload({ waitUntil: "load" }); await page.waitForTimeout(6000);
    await page.screenshot({ path: `${OUT}/${tag}-3-card.png` });
    const c = await page.evaluate(() => { const r = document.querySelector("#card").getBoundingClientRect(); return { cardH: Math.round(r.height), cardTop: Math.round(r.top), sw: document.documentElement.scrollWidth }; });
    report.push({ tag, ...m, ...c, errors: errs.slice(0, 5) });
    await ctx.close();
  }
  await browser.close();
}
console.log(JSON.stringify(report, null, 1));

// The round-two views: the list with amenity icons, a row clicked (desktop: card + pin pop-up; phone: pop-up).
import { createRequire } from "module";
const require = createRequire("C:/Users/luxbo/Documents/Code/sage-desktop/package.json");
const { chromium, webkit } = require("playwright");
const OUT = process.argv[2]; const out = [];
for (const [eng, E, name, w, h, dpr, touch] of [["chromium", chromium, "desktop-1440", 1440, 900, 1, false], ["webkit", webkit, "phone-390", 390, 844, 3, true], ["webkit", webkit, "fold-cover-344", 344, 882, 2.625, true], ["chromium", chromium, "phone-land-844", 844, 390, 3, true]]) {
  const b = await E.launch(eng === "chromium" ? { args: ["--use-angle=d3d11"] } : {});
  const c = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: touch, isMobile: touch && eng === "chromium" });
  const p = await c.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(String(e).slice(0, 150)));
  await p.goto("about:blank"); await p.goto("http://127.0.0.1:4317/StarFinder.html"); await p.waitForTimeout(6000);
  if (touch && w < 900) { await p.click("#burger"); await p.waitForTimeout(400); }
  await p.screenshot({ path: `${OUT}/r2-${eng}-${name}-list.png` });
  await p.click('.row[data-id="tx-inks-lake"]'); await p.waitForTimeout(3200);
  await p.screenshot({ path: `${OUT}/r2-${eng}-${name}-pop.png` });
  const m = await p.evaluate(() => ({ pop: !!document.querySelector(".pop"), icons: document.querySelectorAll(".amen i").length, sw: document.documentElement.scrollWidth, iw: innerWidth }));
  out.push({ v: `${eng}-${name}`, ...m, errs }); await b.close();
}
console.log(JSON.stringify(out));

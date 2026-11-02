/* StarFinder forecast: a seven-day outlook for one place, fetched only when that place is opened.
   Source: the US National Weather Service API (api.weather.gov; "open data, free to use for any purpose"),
   read from its gridpoint data, which carries explicit hail, sky cover by the hour, and amounts.
   If NWS does not answer, Open-Meteo fills in (free for non-commercial use, data CC BY 4.0, shown with
   "Weather data by Open-Meteo.com" beside it, as its licence asks). Answers are kept in this browser for
   30 minutes; an older copy (up to 12 hours) is shown, labelled, when neither service can be reached.
   Nothing about the person is sent: only the park's coordinates. */
(() => {
  "use strict";
  const H = 3600e3, DAY = 864e5, TTL = 30 * 60e3, STALE_OK = 12 * H, POINT_TTL = 7 * DAY, TIMEOUT = 9000;
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const DOWL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode or full: memory only */ } },
  };
  const mem = new Map(), inflight = new Map();

  /* ---------- time, in the park's own time zone ---------- */
  const fmts = new Map();
  function parts(ms, tz) {
    let f = fmts.get(tz);
    if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }); fmts.set(tz, f); }
    const o = {}; for (const p of f.formatToParts(ms)) o[p.type] = p.value;
    return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second };
  }
  const offset = (ms, tz) => { const p = parts(ms, tz); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000; };
  function midnight(utcDate, tz) {                      // local 00:00 of a calendar date, as epoch ms
    const g = utcDate.getTime(); const t = g - offset(g, tz); return g - offset(t, tz);
  }
  function calendar(tz, n, now = Date.now()) {          // n local days from today: key, start, end, weekday
    const p = parts(now, tz), out = [];
    for (let i = 0; i < n; i++) {
      const a = new Date(Date.UTC(p.y, p.m - 1, p.d + i)), b = new Date(Date.UTC(p.y, p.m - 1, p.d + i + 1));
      out.push({ key: a.toISOString().slice(0, 10), s: midnight(a, tz), e: midnight(b, tz), dow: a.getUTCDay() });
    }
    return out;
  }
  const todayKey = (tz) => calendar(tz, 1)[0].key;
  const guessTz = (p) => (p.lon < -104.92 ? "America/Denver" : "America/Chicago");   // El Paso's corner runs on Mountain time
  function clock(ms, tz) {
    try { return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(ms); } catch (e) { return ""; }
  }

  /* ---------- the moon: illuminated fraction from the mean synodic month (good to a few percent) ---------- */
  const SYNODIC = 29.530588853, NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
  function moonLit(ms) {
    const age = ((((ms - NEW_MOON) / DAY) % SYNODIC) + SYNODIC) % SYNODIC;
    return (1 - Math.cos((2 * Math.PI * age) / SYNODIC)) / 2;
  }

  /* ---------- network ---------- */
  async function getJSON(url, nws) {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), TIMEOUT);
    try {
      const r = await fetch(url, nws ? { signal: ac.signal, headers: { Accept: "application/geo+json" } } : { signal: ac.signal });
      if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
      return await r.json();
    } finally { clearTimeout(t); }
  }
  const coord = (x) => String(+x.toFixed(4));           // NWS redirects anything past four decimals

  /* ---------- reading the NWS grid: intervals like "2026-11-03T06:00:00+00:00/PT6H" ---------- */
  function span(vt) {
    const [a, d] = String(vt).split("/"), s = Date.parse(a);
    const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(d || "PT1H") || [];
    return [s, s + ((+m[1] || 0) * 24 + (+m[2] || 0)) * H + (+m[3] || 0) * 60e3];
  }
  const series = (f) => ((f && f.values) || []).map((x) => { const [s, e] = span(x.validTime); return { s, e, v: x.value }; })
    .filter((x) => x.v != null && isFinite(x.s) && x.e > x.s);
  const overlap = (x, a, b) => Math.max(0, Math.min(x.e, b) - Math.max(x.s, a));
  const covered = (ser, a, b) => ser.reduce((t, x) => t + overlap(x, a, b), 0) / (b - a);
  const sumIn = (ser, a, b) => ser.reduce((t, x) => t + (x.v * overlap(x, a, b)) / (x.e - x.s), 0);
  function maxIn(ser, a, b) { let m = null; for (const x of ser) if (overlap(x, a, b)) m = m == null ? x.v : Math.max(m, x.v); return m; }
  function meanIn(ser, a, b, need = 0.75) {         // a time-weighted mean, or null when too little of the window has data
    let t = 0, w = 0; for (const x of ser) { const o = overlap(x, a, b); if (o) { t += x.v * o; w += o; } }
    return w >= (b - a) * need ? t / w : null;
  }
  const RANK = { slight_chance: 1, isolated: 1, chance: 2, scattered: 2, patchy: 2, likely: 3, numerous: 3, areas: 3, periods: 3,
    occasional: 3, intermittent: 3, brief: 3, definitely: 4, widespread: 4, frequent: 4 };
  function weatherIn(ser, a, b) {
    const out = [];
    for (const x of ser) if (overlap(x, a, b)) for (const w of x.v || []) if (w && w.weather) out.push({ t: w.weather, r: RANK[w.coverage] || 2, at: w.attributes || [] });
    return out;
  }

  /* ---------- one icon per day ---------- */
  function classify(d) {
    const wx = d.wx || [], pop = d.pop ?? 0;
    const has = (re, min = 1) => wx.some((w) => re.test(w.t) && w.r >= min);
    const hail = wx.some((w) => w.t === "hail" || w.at.some((a) => /hail/.test(a)));
    const storm = has(/^thunderstorms$/, 2) || (has(/^thunderstorms$/) && pop >= 40);
    const wet = pop >= 25 || (d.liq ?? 0) >= 0.02 || (d.snow ?? 0) >= 0.1;
    if (hail && (wet || storm)) return "hail";
    if (storm && (wet || pop >= 20)) return "storm";
    if (wet) {
      const icy = (d.ice ?? 0) >= 0.01 || has(/^(freezing_rain|freezing_drizzle|sleet)$/);
      const snowy = (d.snow ?? 0) >= 0.1 || has(/^(snow|snow_showers|blowing_snow)$/, 2);
      const rainy = has(/^(rain|rain_showers|drizzle)$/, 2) || ((d.liq ?? 0) >= 0.02 && !snowy);
      if (icy) return "ice";
      if (snowy && rainy) return "mix";
      if (snowy) return "snow";
      return "rain";
    }
    return skyKind(d.sky);
  }
  const skyKind = (sky) => (sky == null ? "partly" : sky < 25 ? "clear" : sky < 70 ? "partly" : "cloudy");
  const WORDS = { clear: "mostly clear", partly: "partly cloudy", cloudy: "cloudy", rain: "rain", mix: "rain and snow", snow: "snow",
    ice: "freezing rain or sleet", storm: "thunderstorms", hail: "thunderstorms with hail" };
  function extras(d) {
    const wx = d.wx || [], out = [];
    if (d.kind !== "storm" && d.kind !== "hail" && wx.some((w) => w.t === "thunderstorms")) out.push("a chance of thunderstorms");
    if (wx.some((w) => w.at.includes("large_hail"))) out.push("large hail possible");
    if (wx.some((w) => /fog/.test(w.t))) out.push("fog");
    return out;
  }

  async function fromNws(p) {
    const pk = `sf-pt1:${coord(p.lat)},${coord(p.lon)}`;
    let pt = store.get(pk);
    if (!pt || Date.now() - pt.t > POINT_TTL) {
      const j = await getJSON(`https://api.weather.gov/points/${coord(p.lat)},${coord(p.lon)}`, true);
      const pr = j.properties || {};
      if (!pr.forecastGridData) throw new Error("NWS has no forecast grid for this point");
      pt = { t: Date.now(), grid: pr.forecastGridData, tz: pr.timeZone || guessTz(p) };
      store.set(pk, pt);
    }
    const g = (await getJSON(pt.grid, true)).properties || {}, tz = pt.tz;
    const S = (k) => series(g[k]);
    const maxT = S("maxTemperature"), minT = S("minTemperature"), pop = S("probabilityOfPrecipitation"), qpf = S("quantitativePrecipitation");
    const snow = S("snowfallAmount"), ice = S("iceAccumulation"), sky = S("skyCover"), wx = S("weather");
    if (!maxT.length && !qpf.length && !sky.length) throw new Error("NWS grid came back empty");
    const f = (c) => (c == null ? null : Math.round((c * 9) / 5 + 32)), inch = (ser, a, b) => (covered(ser, a, b) >= 0.5 ? sumIn(ser, a, b) / 25.4 : null);
    const days = calendar(tz, 7).map((c) => {
      const hi = maxT.find((x) => x.s >= c.s && x.s < c.e), lo = minT.find((x) => x.s >= c.s + 12 * H && x.s < c.s + 30 * H);
      const d = { key: c.key, dow: c.dow, s: c.s, hi: hi ? f(hi.v) : null, lo: lo ? f(lo.v) : null, pop: maxIn(pop, c.s, c.e),
        liq: inch(qpf, c.s, c.e), snow: inch(snow, c.s, c.e), ice: inch(ice, c.s, c.e),
        sky: meanIn(sky, c.s + 7 * H, c.s + 19 * H, 0.4), night: meanIn(sky, c.s + 21 * H, c.s + 27 * H), wx: weatherIn(wx, c.s, c.e) };
      d.kind = classify(d); d.extra = extras(d); delete d.wx;
      return d;
    });
    return { src: "nws", tz, updated: Date.parse(g.updateTime) || Date.now(), link: `https://forecast.weather.gov/MapClick.php?lat=${coord(p.lat)}&lon=${coord(p.lon)}`, days };
  }

  /* ---------- the fallback: Open-Meteo, WMO weather codes ---------- */
  function omKind(code, d) {
    const wet = (d.pop ?? 0) >= 25 || (d.liq ?? 0) >= 0.02 || (d.snow ?? 0) >= 0.1;
    if (code === 96 || code === 99) return "hail";
    if (code === 95) return "storm";
    if (wet && [56, 57, 66, 67].includes(code)) return "ice";
    if (wet && ((code >= 71 && code <= 77) || code === 85 || code === 86)) return (d.rain ?? 0) >= 0.02 ? "mix" : "snow";
    if (wet && ((code >= 51 && code <= 67) || (code >= 80 && code <= 82))) return "rain";
    if (code === 0 || code === 1) return "clear";
    if (code === 2) return "partly";
    if (code === 3) return "cloudy";
    return skyKind(d.sky);
  }
  async function fromOm(p) {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${p.lat.toFixed(3)}&longitude=${p.lon.toFixed(3)}` +
      "&daily=weather_code,temperature_2m_max,precipitation_sum,rain_sum,showers_sum,snowfall_sum,precipitation_probability_max" +
      "&hourly=temperature_2m,cloud_cover&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=auto&forecast_days=8";
    const j = await getJSON(u, false), D = j.daily, Hr = j.hourly;
    if (!D || !D.time || !Hr) throw new Error("Open-Meteo answer was incomplete");
    const tz = j.timezone || guessTz(p), byDay = new Map();
    Hr.time.forEach((t, i) => { const k = t.slice(0, 10); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push({ h: +t.slice(11, 13), T: Hr.temperature_2m[i], c: Hr.cloud_cover[i] }); });
    const pick = (k, a, b, f) => (byDay.get(k) || []).filter((x) => x.h >= a && x.h < b && x[f] != null).map((x) => x[f]);
    const avg = (xs, n) => (xs.length >= n ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const cal = calendar(tz, 7), want = new Set(cal.map((c) => c.key));
    const days = D.time.map((k, i) => {
      if (!want.has(k)) return null;
      const c = cal.find((x) => x.key === k), next = D.time[i + 1];
      const nightT = [...pick(k, 18, 24, "T"), ...(next ? pick(next, 0, 9, "T") : [])];
      const d = { key: k, dow: c.dow, s: c.s, hi: D.temperature_2m_max[i] == null ? null : Math.round(D.temperature_2m_max[i]),
        lo: nightT.length >= 12 ? Math.round(Math.min(...nightT)) : null, pop: D.precipitation_probability_max[i],
        liq: D.precipitation_sum[i], snow: D.snowfall_sum[i], ice: null, rain: (D.rain_sum[i] || 0) + (D.showers_sum[i] || 0),
        sky: avg(pick(k, 7, 19, "c"), 9), night: next ? avg([...pick(k, 21, 24, "c"), ...pick(next, 0, 3, "c")], 5) : null };
      d.kind = omKind(D.weather_code[i], d); d.extra = []; delete d.rain;
      return d;
    }).filter(Boolean);
    return { src: "om", tz, updated: Date.now(), link: "https://open-meteo.com/", days };
  }

  /* ---------- cache, then NWS, then Open-Meteo, then an older copy ---------- */
  async function get(p, force) {
    const k = "sf-wx1:" + p.id, c = mem.get(k) || store.get(k);
    if (!force && c && Date.now() - c.t < TTL) return c.m;
    if (inflight.has(k)) return inflight.get(k);
    const job = (async () => {
      const errs = []; let m = null;
      if (navigator.onLine !== false) {
        try { m = await fromNws(p); } catch (e) { errs.push(String(e.message || e)); }
        if (!m) try { m = await fromOm(p); } catch (e) { errs.push(String(e.message || e)); }
      }
      if (m) { const v = { t: Date.now(), m }; mem.set(k, v); store.set(k, v); return m; }
      if (c && Date.now() - c.t < STALE_OK) return { ...c.m, stale: c.t, offline: navigator.onLine === false };
      const err = new Error(errs.join("; ") || "offline"); err.offline = navigator.onLine === false; throw err;
    })();
    inflight.set(k, job);
    try { return await job; } finally { inflight.delete(k); }
  }

  /* ---------- icons: drawn here, flat and round, gold light and starlit clouds ---------- */
  const C = { sun: "#f4c95d", cloud: "#ebe6fb", back: "#a59cc6", storm: "#8b82ad", drop: "#86b6ff", flake: "#f3f6ff", ice: "#a9dcff", bolt: "#f4c95d" };
  const cloud = (cx, cy, k, col) => {
    const s = (v) => +(v * k).toFixed(2), X = (v) => +(cx + v * k).toFixed(2), Y = (v) => +(cy + v * k).toFixed(2);
    return `<g fill="${col}"><circle cx="${X(-4)}" cy="${Y(0.6)}" r="${s(3.3)}"/><circle cx="${X(0.4)}" cy="${Y(-2)}" r="${s(4.4)}"/><circle cx="${X(4.5)}" cy="${Y(1)}" r="${s(3.1)}"/><rect x="${X(-7.3)}" y="${Y(0.4)}" width="${s(14.8)}" height="${s(4.3)}" rx="${s(2.15)}"/></g>`;
  };
  const rays = (cx, cy, r1, r2, w) => [0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
    const t = (a * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
    return `<path d="M${(cx + c * r1).toFixed(2)} ${(cy + s * r1).toFixed(2)}L${(cx + c * r2).toFixed(2)} ${(cy + s * r2).toFixed(2)}"/>`;
  }).join("");
  const sun = (cx, cy, r) => `<g stroke="${C.sun}" stroke-width="1.7" stroke-linecap="round">${rays(cx, cy, r + 2.1, r + 3.9)}</g><circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.sun}"/>`;
  const drop = (x, y) => `<path d="M${x + 0.9} ${y}l-1.5 3.6" stroke="${C.drop}" stroke-width="1.9" stroke-linecap="round"/>`;
  const flake = (x, y) => `<g stroke="${C.flake}" stroke-width="1.25" stroke-linecap="round"><path d="M${x} ${y - 1.9}v3.8M${x - 1.65} ${y - 0.95}l3.3 1.9M${x - 1.65} ${y + 0.95}l3.3-1.9"/></g>`;
  const pellet = (x, y) => `<circle cx="${x}" cy="${y}" r="1.45" fill="${C.flake}" stroke="${C.drop}" stroke-width=".9"/>`;
  const sleet = (x, y) => `<path d="M${x} ${y - 1.6}l1.3 1.6-1.3 1.6-1.3-1.6z" fill="${C.ice}"/>`;
  const bolt = `<path d="M12.9 12.6l-3.1 4.8h2.6l-1.5 4.4 4.8-6.2h-2.7l1.7-3z" fill="${C.bolt}" stroke="#2a2148" stroke-width=".6" stroke-linejoin="round"/>`;
  const sparkle = (x, y, r) => `<path d="M${x} ${y - r}l${r * 0.28} ${r * 0.72} ${r * 0.72} ${r * 0.28}-${r * 0.72} ${r * 0.28}-${r * 0.28} ${r * 0.72}-${r * 0.28}-${r * 0.72}-${r * 0.72}-${r * 0.28} ${r * 0.72}-${r * 0.28}z" fill="#fff8e6"/>`;
  const ICON = {
    clear: sun(11.4, 12.6, 4.6) + sparkle(19.6, 4.6, 2.6),
    partly: sun(9, 8.6, 3.5) + cloud(14.2, 14.6, 0.92, C.cloud),
    cloudy: cloud(9.6, 9.4, 0.7, C.back) + cloud(13, 14.2, 0.95, C.cloud),
    rain: cloud(12, 9.4, 0.98, C.cloud) + drop(7.4, 16.6) + drop(11.6, 17.4) + drop(15.8, 16.6),
    snow: cloud(12, 9.4, 0.98, C.cloud) + flake(7.6, 18.4) + flake(12.2, 20.2) + flake(16.8, 18.4),
    mix: cloud(12, 9.4, 0.98, C.cloud) + drop(7.2, 16.6) + flake(12.2, 19.6) + drop(15.6, 16.6),
    ice: cloud(12, 9.4, 0.98, C.cloud) + drop(7.2, 16.6) + sleet(12.2, 19.4) + drop(15.6, 16.6),
    storm: cloud(12, 8.8, 0.98, C.storm) + bolt + drop(6.6, 16.2) + drop(17.2, 16.2),
    hail: cloud(12, 8.8, 0.98, C.storm) + bolt + pellet(7.2, 18.2) + pellet(17.4, 18.8) + pellet(5.6, 21.6),
  };
  const icon = (k) => `<svg class="wx-ic" viewBox="0 0 24 24" aria-hidden="true">${ICON[k] || ICON.partly}</svg>`;
  const DROP = '<svg class="wx-dr" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.2c1.7 2.3 3.2 4 3.2 5.8a3.2 3.2 0 0 1-6.4 0C2.8 5.2 4.3 3.5 6 1.2z" fill="currentColor"/></svg>';
  const STAR = (cls) => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.4 7.1 7.1 2.4-7.1 2.4L12 21.5l-2.4-7.1L2.5 12l7.1-2.4z" fill="#f4c95d"/></svg>`;

  /* ---------- words and numbers ---------- */
  const deg = (v) => (v == null ? "&ndash;" : `${v}&deg;`);
  const pct = (v) => (v == null ? "&ndash;" : `${Math.round(v)}%`);
  const inches = (v) => (v == null ? null : v < 0.005 ? "0" : v < 1 ? v.toFixed(2) : v.toFixed(1));
  function amount(d) {
    if ((d.snow ?? 0) >= 0.1) return { txt: `${inches(d.snow)}&Prime;`, snow: true, say: `about ${inches(d.snow)} inches of snow` };
    const v = inches(d.liq);
    if (v == null) return { txt: "&ndash;", say: "no amount given" };
    return { txt: `${v}&Prime;`, dim: v === "0", say: v === "0" ? "no measurable rain" : `about ${v} inches of rain` };
  }
  const dayName = (d, i) => (i === 0 ? "Today" : DOW[d.dow]);   // "Tonight" is too wide for a 34px column; the spoken sentence says it
  function sentence(d, i) {
    const a = amount(d), name = i === 0 ? (d.hi == null ? "Tonight" : "Today") : DOWL[d.dow];
    let t = [d.hi != null ? `high ${d.hi} degrees` : "", d.lo != null ? `low ${d.lo} that night` : ""].filter(Boolean).join(", ");
    t = t.charAt(0).toUpperCase() + t.slice(1);
    return `${name}: ${WORDS[d.kind]}${d.extra && d.extra.length ? ", " + d.extra.join(", ") : ""}. ${t ? t + ". " : ""}${d.pop != null ? Math.round(d.pop) + "% chance of precipitation, " : ""}${a.say}.`;
  }
  function bestNight(m) {
    const ok = m.days.filter((d) => d.night != null);
    if (!ok.length) return null;
    return ok.reduce((b, d) => (d.night < b.night ? d : b));
  }
  function nightLine(m) {
    const b = bestNight(m); if (!b) return "";
    const i = m.days.indexOf(b), name = i === 0 ? "tonight" : DOWL[b.dow];
    const moon = Math.round(moonLit(b.s + 23 * H) * 100), cl = Math.round(b.night);
    if (b.night <= 35) return `<p class="wx-night">${STAR("wx-star")}<span>Clearest night: <b>${name}</b>, about ${cl}% cloud from 9 PM to 3 AM; the moon is about ${moon}% lit.</span></p>`;
    return `<p class="wx-night is-cloudy">${STAR("wx-star")}<span>No clear night ahead: the least cloud is about ${cl}%, <b>${name}</b> night (moon about ${moon}% lit).</span></p>`;
  }
  function source(m, mini) {
    const when = m.stale ? `saved ${clock(m.stale, m.tz)}${m.offline ? ", you're offline" : ", could not refresh"}`
      : `${m.src === "om" ? "fetched" : "updated"} ${clock(m.updated, m.tz)}`;   // Open-Meteo gives no issue time, so say when we asked
    if (m.src === "om") return mini ? `<a href="https://open-meteo.com/" target="_blank" rel="noopener">Weather data by Open-Meteo.com</a>`
      : `<a href="https://open-meteo.com/" target="_blank" rel="noopener">Weather data by Open-Meteo.com</a> (CC BY 4.0), ${when}. The National Weather Service did not answer.`;
    return mini ? `<a href="${esc(m.link)}" target="_blank" rel="noopener">National Weather Service</a> · ${when}`
      : `Forecast from the <a href="${esc(m.link)}" target="_blank" rel="noopener">National Weather Service</a>, ${when}. Highs by day, lows that night.`;
  }

  /* ---------- views: the card's full week and the pop-up's strip ---------- */
  function view(m, mode) {
    const today = todayKey(m.tz), days = m.days.filter((d) => d.key >= today).slice(0, 7);
    if (!days.length) throw new Error("the saved forecast is out of date");
    const best = bestNight(m), mini = mode === "mini";
    const cols = days.map((d, i) => {
      const a = amount(d), wet = (d.pop ?? 0) >= 30, isBest = !mini && best === d && best.night <= 35;
      return `<li class="wx-day${i === 0 ? " is-today" : ""}${isBest ? " is-best" : ""}" data-kind="${d.kind}">${isBest ? STAR("wx-mark") : ""}
        <span class="sr-only">${esc(sentence(d, i))}</span>
        <span class="wx-d" aria-hidden="true">${dayName(d, i)}</span>${icon(d.kind)}
        <span class="wx-hi" aria-hidden="true">${deg(d.hi)}</span><span class="wx-lo" aria-hidden="true">${deg(d.lo)}</span>
        <span class="wx-p${wet ? " is-wet" : ""}" aria-hidden="true">${DROP}${pct(d.pop)}</span>
        ${mini ? "" : `<span class="wx-a${a.dim ? " is-dim" : ""}${a.snow ? " is-snow" : ""}" aria-hidden="true">${a.txt}</span>`}</li>`;
    }).join("");
    if (mini) return `<ol class="wx-days" aria-label="Seven-day forecast">${cols}</ol><p class="wx-src">${source(m, true)}</p>`;
    return `<div class="wx-head"><h3 id="wxTitle">Next 7 days</h3>${m.stale ? '<button class="wx-retry" data-wx-retry>Refresh</button>' : ""}</div>
      <ol class="wx-days" aria-labelledby="wxTitle">${cols}</ol>${nightLine(m)}<p class="wx-src">${source(m, false)}</p>`;
  }
  function skeleton(p, mode) {
    const days = calendar(guessTz(p), 7);
    const cols = days.map((d, i) => `<li class="wx-day is-wait${i === 0 ? " is-today" : ""}"><span class="wx-d">${i === 0 ? "Today" : DOW[d.dow]}</span><span class="wx-ic wx-ph"></span><span class="wx-hi">&ndash;</span><span class="wx-lo">&ndash;</span><span class="wx-p">&nbsp;</span>${mode === "mini" ? "" : '<span class="wx-a">&nbsp;</span>'}</li>`).join("");
    const head = mode === "mini" ? "" : '<div class="wx-head"><h3 id="wxTitle">Next 7 days</h3></div>';
    return `${head}<ol class="wx-days" aria-hidden="true">${cols}</ol><p class="wx-src">Loading the forecast&hellip;</p>`;
  }
  function failed(e, mode) {
    const off = e && e.offline;
    const msg = off ? "You're offline, so the forecast can't load. It will try again when you're back online."
      : "The forecast didn't load: neither the National Weather Service nor Open-Meteo answered.";
    if (mode === "mini") return `<p class="wx-msg">${off ? "Forecast unavailable offline." : "Forecast unavailable right now."} <button class="wx-retry" data-wx-retry>Try again</button></p>`;
    return `<div class="wx-head"><h3 id="wxTitle">Next 7 days</h3></div><p class="wx-msg">${msg} <button class="wx-retry" data-wx-retry>Try again</button></p>`;
  }

  /* ---------- mount: skeleton first, then the week; stale answers for a closed card are dropped ---------- */
  const mounted = new Map();
  function bindRetry(el, p, mode) {
    const r = el.querySelector("[data-wx-retry]"); if (r) r.addEventListener("click", (ev) => { ev.stopPropagation(); mount(el, p, mode, true); });
  }
  function mount(el, p, mode, force) {
    for (const k of mounted.keys()) if (!k.isConnected) mounted.delete(k);
    const tok = String(Math.random()); el.dataset.wxTok = tok; mounted.set(el, { p, mode });
    el.classList.add("wx", mode === "mini" ? "wx-mini" : "wx-full"); delete el.dataset.wxFailed;
    const hit = !force && mem.get("sf-wx1:" + p.id);   // a fresh week already in memory draws at once, with no skeleton flash
    if (hit && Date.now() - hit.t < TTL) { try { el.innerHTML = view(hit.m, mode); el.removeAttribute("aria-busy"); bindRetry(el, p, mode); return; } catch (e) { /* fall through */ } }
    el.setAttribute("aria-busy", "true"); el.innerHTML = skeleton(p, mode);
    const done = (html, failedNow) => {
      if (el.dataset.wxTok !== tok || !el.isConnected) return;
      el.innerHTML = html; el.removeAttribute("aria-busy");
      if (failedNow) el.dataset.wxFailed = "1";
      bindRetry(el, p, mode);
    };
    get(p, force).then((m) => {
      let html; try { html = view(m, mode); } catch (e) { done(failed(e, mode), true); return; }
      done(html, false);
    }).catch((e) => done(failed(e, mode), true));
  }
  addEventListener("online", () => {
    for (const [el, { p, mode }] of mounted) { if (!el.isConnected) mounted.delete(el); else if (el.dataset.wxFailed) mount(el, p, mode, true); }
  });

  window.SFWeather = { mount, get, moonLit, _test: { span, calendar, classify, omKind, parts } };
})();

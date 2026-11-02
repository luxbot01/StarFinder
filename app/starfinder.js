/* StarFinder app. Plain JavaScript, no build step. Data: data/places.json (park facts, modelled sky, photos with their credits),
   data/burnbans.json (written every 6 hours by tools/burnbans.py), tiles/sky (our model), photos/ (resized copies). */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isPhone = () => matchMedia("(max-width: 899px)").matches;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const state = { places: [], byId: new Map(), filters: { camping: false, darksky: false, four: false, noban: false }, amenOn: new Set(), clearSet: new Set(),
    agency: "all", sort: "dark", q: "", sel: null, me: null, map: null, mapReady: false, burn: null, burnDone: false, banSet: new Set(), visIds: [] };
  window.__sf = state;   // read-only handle for the test harness

  /* ---------- small helpers ---------- */
  const STAR = "M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z";
  function starsSvg(n, big) {
    let h = `<span class="stars${big ? " big" : ""}" role="img" aria-label="${n} of 5 stars">`;
    for (let i = 1; i <= 5; i++) {
      const fill = n >= i ? "" : n >= i - 0.5 ? ' clip-path="url(#sfHalf)"' : ' opacity="0"';
      h += `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${STAR}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" opacity=".55"/><path d="${STAR}" fill="currentColor"${fill}/></svg>`;
    }
    return h + "</span>";
  }
  // Two colours only (Rose, Nov 1): a darker purple for dim skies ("nice for hanging out") to gold for the best ("really
  // good stars"), mixed in OKLab from oklch(0.50 0.16 302) to oklch(0.86 0.15 84), one step per half star. The ends differ
  // 4.2:1 in luminance, so they read apart for every kind of colour vision; the purple keeps 3:1 on the map's ink.
  const DOTS = ["#7546ad", "#8258a9", "#9068a4", "#9e779e", "#ad8597", "#bd938e", "#cda083", "#ddad76", "#eebb64", "#ffc84b"];
  const starColor = (s) => DOTS[Math.max(0, Math.min(9, Math.round(s * 2) - 1))];
  const agencyOf = (p) => p.id.split("-")[0] === "tx" ? "tpwd" : p.id.split("-")[0];
  function km(a, b) {
    const R = 6371, r = Math.PI / 180, dl = (b.lat - a.lat) * r, dn = (b.lon - a.lon) * r;
    const h = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dn / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const mi = (k) => Math.round(k * 0.621371);
  const darkWords = (sqm) => sqm >= 21.85 ? "A truly dark sky" : sqm >= 21.5 ? "A dark rural sky" : sqm >= 20.9 ? "Rural, with a glow on the horizon"
    : sqm >= 20.0 ? "Edge of town: the Milky Way is faint" : sqm >= 19.0 ? "Suburban sky" : "City sky: only the brightest stars";
  const KINDS = { tent: "Tent sites", rv_hookups: "RV hookups", primitive: "Primitive sites", backcountry: "Backcountry", cabins: "Cabins",
    screened_shelters: "Screened shelters", lodge: "Lodge", equestrian: "Equestrian", group: "Group sites", dispersed: "Dispersed camping" };

  /* ---------- amenity icons: drawn here, one stroke weight, currentColor ---------- */
  const IC = {
    amp30: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7.4 9.6l2.6-1.5M16.6 9.6L14 8.1" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="15.6" r="1.6" fill="currentColor"/></svg>',
    amp50: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 8.6v3.6M16 8.6v3.6M10.6 15.8h2.8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M12 5.6v2.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    water: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2c3 4 5.6 7 5.6 10.2a5.6 5.6 0 0 1-11.2 0C6.4 10.2 9 7.2 12 3.2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9.4 14a2.7 2.7 0 0 0 2.4 2.7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    waterSite: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h7.5a3.5 3.5 0 0 1 3.5 3.5V14M4 6.5v5M15 14.5v1.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 5h3M15 18.6c0 1.1.8 2 1.8 2s1.8-.9 1.8-2c0-1-1.8-3.2-1.8-3.2s-1.8 2.2-1.8 3.2z" fill="currentColor"/></svg>',
    restrooms: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="7.5" cy="5" r="1.9" fill="currentColor"/><circle cx="16.5" cy="5" r="1.9" fill="currentColor"/><path d="M5.6 9h3.8v6H8.5v5h-2v-5h-.9zM14.6 9h3.8l1.5 6h-1.8v5h-1.6v-5h-1.6v5h-1.6v-5H11z" fill="currentColor"/><path d="M12 8v13" stroke="currentColor" stroke-width="1" opacity=".5"/></svg>',
    showers: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6.5a4 4 0 0 1 4 4v1" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M10.5 9.5h8l-1.3 2.2h-5.4z" fill="currentColor"/><path d="M11.6 14.2l-.6 1.6M14.5 14.2v1.8M17.4 14.2l.6 1.6M11 18.4l-.6 1.6M14.5 18.4v1.8M18 18.4l.6 1.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    cabins: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.2 11.2L12 4.2l8.8 7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.6 10v9.6h12.8V10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M10.2 19.6v-5h3.6v5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M15.6 6.2V4.4h1.8v3.2" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
    // the household 120 V outlet (NEMA 5-15 face; a 5-20 takes the same plug): the rounded-square plate of a wall outlet, so it
    // never reads as the round RV faces beside it; two upright slots, the left (neutral) longer, and the round-topped ground below
    out120: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.2" y="3.2" width="13.6" height="17.6" rx="3.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9.6 7.4v4.6M14.4 7.9v3.6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M10.7 17.7v-1.3a1.3 1.3 0 0 1 2.6 0v1.3z" fill="currentColor"/></svg>',
  };
  // One order everywhere the icons appear (list rows, the pop-up, the card and the filter row), so the hand finds each icon in the
  // same place: power first, by amperage (50, 30, then the 20-amp household outlet), then water, restrooms, showers, cabins.
  const AMEN = [["rv50", "amp50", "50-amp RV hookups", "50A"], ["rv30", "amp30", "30-amp RV hookups", "30A"], ["rv120", "out120", "120 V household outlet (20-amp)", "120V"],
    ["waterSite", "waterSite", "Water hookups at sites"], ["water", "water", "Drinking water"], ["restrooms", "restrooms", "Restrooms"], ["showers", "showers", "Showers"],
    ["cabins", "cabins", "Cabins or lodging"]];
  const SHORT = { rv50: "50A", rv30: "30A", rv120: "120V", waterSite: "water at sites", water: "drinking water", restrooms: "restrooms", showers: "showers", cabins: "cabins" };
  // the burn-ban mark leads the strip when a current reading says this place is under a ban: it is a condition of the day,
  // not a facility, so it comes before the amenities and in its own colour (app/burnban.js owns the glyph and the label)
  const banChip = (p) => state.burnDone && window.SFBurn ? window.SFBurn.chip(p, state.burn, Date.now()) : "";
  function amenStrip(p) {
    const a = p.amen || {};
    return banChip(p) + AMEN.filter(([k]) => a[k] === true).map(([k, ic, label, amp]) =>
      `<i class="${amp ? "amp" : ""}" title="${label}" aria-label="${label}">${IC[ic]}${amp ? amp : ""}</i>`).join("");
  }
  // the exact words that name the 20-amp (household 120 V) outlet, out of the page slice kept in places.json
  const says20 = (q) => (q.match(/(?:\d+\/)*\b20\b(?:\/\d+)*[- ]?amp\w*(?: (?:hookups?|electric\w*|service|electrical hookup))?|\b20\b[- ]?amp[^.]{0,20}|\b(?:110|115|120)[- ]?v\w*/i) || [q.slice(-60)])[0].trim();
  function amenFull(p) {
    const a = p.amen || {};
    const known = AMEN.filter(([k]) => a[k] === true || a[k] === false);
    if (!known.length) return "";
    return `<div><h3>At the park</h3><div class="amen-full">${known.map(([k, ic, label]) =>
      `<span class="${a[k] ? "" : "no"}">${IC[ic]}${label}${a[k] ? "" : '<span class="sr-only"> (none)</span>'}</span>`).join("")}</div>
      ${a.src ? `<p class="prov" style="margin-top:6px">Amenities from <a href="${esc(a.src)}" target="_blank" rel="noopener">the park's page</a>.</p>` : ""}
      ${a.rv120 && a.rv120src ? `<p class="prov" style="margin-top:4px">120 V outlet: <a href="${esc(a.rv120src.url)}" target="_blank" rel="noopener">the park's campsite page</a> lists "${esc(says20(a.rv120src.quote))}".</p>` : ""}</div>`;
  }

  /* ---------- filtering, sorting and the list ---------- */
  function visible() {
    const q = state.q.trim().toLowerCase(), f = state.filters;
    let out = state.places.filter((p) =>
      (!f.camping || p.camping === true) && (!f.darksky || p.darkSky) && (!f.four || p.sky.stars >= 4) && (!f.noban || !state.burnCurrent || state.clearSet.has(p.id)) &&
      [...state.amenOn].every((k) => p.amen && p.amen[k] === true) &&   // the icon toggles: a place must have ALL that are on
      (state.agency === "all" || agencyOf(p) === state.agency) &&
      (!q || [p.name, p.town, p.county, p.type].some((v) => v && String(v).toLowerCase().includes(q))));
    const from = state.me || (state.map ? (({ lng, lat }) => ({ lat, lon: lng }))(state.map.getCenter()) : { lat: 31.2, lon: -99.3 });
    out.forEach((p) => (p._d = km(from, p)));
    if (state.sort === "dark") out.sort((a, b) => b.sky.pct - a.sky.pct || a.name.localeCompare(b.name));
    else if (state.sort === "near") out.sort((a, b) => a._d - b._d);
    else out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }
  function renderList() {
    const items = visible(), ul = $("#list");
    const where = state.sort === "near" ? (state.me ? " · distances from you" : " · distances from the map's centre") : "";
    const withAll = state.amenOn.size ? " with " + AMEN.filter(([k]) => state.amenOn.has(k)).map(([k]) => SHORT[k]).join(" AND ") : "";
    $("#count").textContent = `${items.length} of ${state.places.length} places${withAll}${where}`;
    $("#fClear").hidden = !filtering();
    writeHash();
    ul.innerHTML = items.map((p) => {
      const sub = [p.type, p.town || p.county].filter(Boolean).join(" · ") + (state.sort === "near" ? ` · ${mi(p._d)} mi` : "");
      return `<li><button class="row" data-id="${esc(p.id)}"${state.sel === p.id ? ' aria-current="true"' : ""}>
        <svg class="dot" viewBox="0 0 30 30" aria-hidden="true"><circle cx="15" cy="15" r="11" fill="${starColor(p.sky.stars)}" opacity=".16"/><path d="M15 5.5l1.7 7.8 7.8 1.7-7.8 1.7L15 24.5l-1.7-7.8L5.5 15l7.8-1.7z" fill="${starColor(p.sky.stars)}"/></svg>
        <span class="nm">${esc(p.name)}</span>
        <span class="rate">${starsSvg(p.sky.stars)}<span class="pct">${Math.round(p.sky.pct)}% of stars</span></span>
        <span class="sub">${esc(sub)}${p.darkSky ? " · Dark Sky Place" : ""}</span>
        ${amenStrip(p) ? `<span class="amen">${amenStrip(p)}</span>` : ""}
      </button></li>`;
    }).join("") || `<li class="count" style="padding:12px">No place matches. Clear a filter or the search.</li>`;
    state.visIds = items.map((p) => p.id);
    if (state.mapReady) state.map.setFilter("pl-core", ["in", ["get", "id"], ["literal", state.visIds]]);
    if (state.mapReady) state.map.setFilter("pl-glow", ["in", ["get", "id"], ["literal", state.visIds]]);
    banFilter();
  }
  const filtering = () => state.amenOn.size > 0 || Object.values(state.filters).some(Boolean) || state.agency !== "all";
  // the hash carries the open place and the filters (#p=<id>&f=darksky.rv50.showers), so a shared link opens the same view
  function writeHash() {
    const parts = [];
    if (state.sel) parts.push("p=" + encodeURIComponent(state.sel));
    const f = [...Object.keys(state.filters).filter((k) => state.filters[k]), ...AMEN.map(([k]) => k).filter((k) => state.amenOn.has(k))];
    if (f.length) parts.push("f=" + f.join("."));
    const h = parts.length ? "#" + parts.join("&") : "";
    if (location.hash !== h) history.replaceState(null, "", location.pathname + location.search + h);
  }
  // the map badge follows the list's filters and the current reading: a place that is hidden, or not under a ban by a current
  // reading, draws no badge
  const banFilter = () => { if (state.mapReady && state.map.getLayer("pl-ban")) state.map.setFilter("pl-ban", ["in", ["get", "id"], ["literal", (state.visIds || []).filter((id) => state.banSet.has(id))]]); };

  /* ---------- the place card ---------- */
  function darkerNearby(p) {
    return state.places.filter((o) => o !== p && o.sky.pct >= p.sky.pct + 8)
      .map((o) => ({ o, d: km(p, o) })).filter((x) => x.d <= 200).sort((a, b) => a.d - b.d).slice(0, 3);
  }
  const PH_SIZES = { card: "(max-width: 899px) calc(100vw - 32px), 348px", pop: "(max-width: 899px) 78vw, 320px" };
  const phSet = (ph) => `${ph.src}-480.webp 480w, ${ph.src}-960.webp 960w`;
  const phAttrs = (ph, where) => ph.src ? `src="${esc(ph.src)}-960.webp" srcset="${esc(phSet(ph))}" sizes="${PH_SIZES[where]}"` : `src="${esc(ph.img)}"`;
  function setPh(img, ph, where) {
    if (ph.src) { img.sizes = PH_SIZES[where]; img.srcset = phSet(ph); img.src = `${ph.src}-960.webp`; } else { img.removeAttribute("srcset"); img.src = ph.img; }
  }
  const warmed = new Set();
  function warm(photos, where) {   // the same sizes and srcset as the visible image, so the browser picks the same file and the click is a cache hit
    for (const ph of photos) {
      const k = (ph.src || ph.img) + "|" + where; if (warmed.has(k)) continue; warmed.add(k);
      const i = new Image(); i.decoding = "async"; setPh(i, ph, where);
    }
  }
  const credit = (ph) => `<a href="${esc(ph.page || ph.img)}" target="_blank" rel="noopener">${esc(ph.credit || ph.source || "Photo")}</a>${ph.license ? ", " + esc(ph.license) : ""}${ph.source ? " · " + esc(ph.source) : ""}`;
  /* Burn-ban line (app/burnban.js; data/burnbans.json is written every 6 hours by tools/burnbans.py). Nothing is drawn until
     the file has answered or failed, so "not available" never flashes before the real line. */
  const federal = (p) => /^(nps|usfs)-/.test(p.id);
  const burnHtml = (p) => state.burnDone && window.SFBurn ? window.SFBurn.html(p, state.burn, Date.now(), federal(p)) : "";
  function burnRefresh() {
    const slot = $("#burnSlot"); if (slot && state.sel && state.byId.has(state.sel)) slot.innerHTML = burnHtml(state.byId.get(state.sel));
    const kinds = new Map(window.SFBurn ? state.places.map((p) => [p.id, window.SFBurn.view(p, state.burn, Date.now()).kind]) : []);
    state.banSet = new Set([...kinds].filter(([, k]) => k === "ban").map(([id]) => id));
    // "No county ban" keeps only places a CURRENT reading says are not on the list (Oklahoma is not tracked, so it drops out);
    // with no current reading the chip is hidden and the filter does nothing, because we never claim what we did not just read
    state.clearSet = new Set([...kinds].filter(([, k]) => k === "none").map(([id]) => id));
    state.burnCurrent = state.banSet.size + state.clearSet.size > 0;
    $('[data-filter="noban"]').hidden = !state.burnCurrent;
    renderList();   // the rows gain or lose the mark (and the map badges follow, through banFilter)
    if (pop && pop.isOpen() && popId && state.byId.has(popId)) {   // a pop-up opened before the file landed gets the mark too
      const pb = pop.getElement().querySelector(".pb"), s = amenStrip(state.byId.get(popId)), old = pb.querySelector(".amen");
      if (old) { if (s) old.innerHTML = s; else old.remove(); } else if (s) pb.querySelector(".pr").insertAdjacentHTML("afterend", `<div class="amen" style="justify-content:center">${s}</div>`);
    }
  }
  function renderCard(p) {
    const s = p.sky, card = $("#card"), photos = p.photos || [];
    const kinds = (p.campingKinds || []).map((k) => `<span class="tag">${esc(KINDS[k] || k)}</span>`).join("");
    const camp = p.camping === true ? (kinds || '<span class="tag">Camping</span>') : p.camping === false ? '<span class="tag">No camping here</span>' : '<span class="tag">Camping not confirmed</span>';
    const dsp = p.darkSky ? `<span class="tag gold">DarkSky International: ${esc(p.darkSky.designation)}${p.darkSky.year ? " (" + esc(p.darkSky.year) + ")" : ""}</span>` : "";
    const pub = p.lpPublished ? `<span class="tag">Published: ${esc(p.lpPublished.value)}</span>` : "";
    const better = darkerNearby(p);
    const dir = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}`;
    const nearPct = s.bestNearbyRatio != null && s.bestNearbyRatio < s.ratio * 0.7;
    card.innerHTML = `
      <div class="grab" aria-hidden="true"></div>
      <div class="head">
        <div style="flex:1;min-width:0"><div class="kicker">${esc(p.type)}</div><h2 id="cardTitle">${esc(p.name)}</h2></div>
        <button class="icon-btn" id="cardClose" aria-label="Close the details"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button>
      </div>
      <div class="body">
        <div class="score">
          <div class="big-pct">${Math.round(s.pct)}<small>%</small></div>
          <div>${starsSvg(s.stars, true)}</div>
          <div class="what">of the stars a pristine sky shows. ${esc(darkWords(s.sqm))}.</div>
        </div>
        <div class="metrics">
          <div class="metric"><div class="v">${s.sqm.toFixed(2)}</div><div class="k">mag/arcsec² overhead</div></div>
          <div class="metric"><div class="v">${s.nelm.toFixed(1)}</div><div class="k">faintest star, naked eye</div></div>
          <div class="metric"><div class="v">${s.ratio < 0.01 ? "&lt;1" : Math.round(s.ratio * 100)}%</div><div class="k">extra glow over a natural sky</div></div>
        </div>
        <div class="tags"><span class="tag model">Modelled from NASA satellite data</span>${dsp}${pub}</div>
        ${nearPct ? `<p class="note">The sky gets noticeably darker within about 8 km of this point; campsites away from town lights may beat this rating.</p>` : ""}
        <section id="wxCard" aria-labelledby="wxTitle"></section>
        <div id="burnSlot">${burnHtml(p)}</div>
        ${photos.length ? `<figure class="photo" style="margin:0"><img id="ph" ${phAttrs(photos[0], "card")} alt="${esc(p.name)}" loading="lazy" onerror="this.closest('figure').hidden=true"><figcaption id="phCap">${credit(photos[0])}</figcaption>${photos.length > 1 ? `<div class="nav"><button data-ph="-1" aria-label="Previous photo">&#8249;</button><button data-ph="1" aria-label="Next photo">&#8250;</button></div>` : ""}</figure>` : ""}
        ${p.blurb ? `<p>${esc(p.blurb)}</p>` : ""}
        ${p.status ? `<p class="prov">Research note: ${esc(p.status)} Check the park's own page before you go.</p>` : ""}
        <div><h3>Staying the night</h3><div class="tags">${camp}</div></div>
        ${amenFull(p)}
        <div class="actions">
          ${p.url ? `<a class="btn primary" href="${esc(p.url)}" target="_blank" rel="noopener">Official page</a>` : ""}
          ${p.reserve ? `<a class="btn" href="${esc(p.reserve)}" target="_blank" rel="noopener">Reservations</a>` : ""}
          <a class="btn" href="${dir}" target="_blank" rel="noopener">Directions</a>
        </div>
        ${p.nearby && p.nearby.length ? `<div><h3>Nearby</h3><ul class="plain">${p.nearby.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>` : ""}
        ${better.length ? `<div><h3>Darker skies within a drive</h3><div class="darker">${better.map(({ o, d }) => `<button data-go="${esc(o.id)}"><span>${esc(o.name)}</span><small>${Math.round(o.sky.pct)}% · ${mi(d)} mi</small></button>`).join("")}</div></div>` : ""}
        <p class="prov">Map point: ${esc(p.coordPoint || "")}${p.coordSource && /^https?:/.test(p.coordSource) ? ` (<a href="${esc(p.coordSource)}" target="_blank" rel="noopener">source</a>)` : ""}. ${p.county ? esc(p.county) + " County. " : ""}${esc(p.agency)}. Sky values are estimates for a clear, moonless night, not measurements.</p>
      </div>`;
    card.setAttribute("aria-labelledby", "cardTitle");
    if (window.SFWeather) window.SFWeather.mount($("#wxCard"), p, "full");
    warm(photos, "card");
    let pi = 0;
    $$("[data-ph]", card).forEach((b) => b.addEventListener("click", () => { pi = (pi + +b.dataset.ph + photos.length) % photos.length; setPh($("#ph"), photos[pi], "card"); $("#phCap").innerHTML = credit(photos[pi]); }));
    $("#cardClose").addEventListener("click", () => select(null));
    $$("[data-go]", card).forEach((b) => b.addEventListener("click", () => select(b.dataset.go, true)));
  }

  function select(id, fly) {
    state.sel = id; const card = $("#card");
    $$(".row").forEach((r) => (r.dataset.id === id ? r.setAttribute("aria-current", "true") : r.removeAttribute("aria-current")));
    if (!id) {
      card.hidden = true; document.body.classList.remove("card-open");
      if (state.mapReady) state.map.setFilter("pl-sel", ["==", ["get", "id"], ""]);
      writeHash(); return;
    }
    const p = state.byId.get(id); if (!p) return;
    renderCard(p); card.hidden = false; document.body.classList.add("card-open");
    if (!reduce) { card.classList.add("enter"); requestAnimationFrame(() => requestAnimationFrame(() => card.classList.remove("enter"))); }
    writeHash();
    if (isPhone()) { setDrawer(false); if (pop) pop.remove(); }   // one sheet at a time on a phone: the card replaces the pop-up
    if (state.mapReady) {
      state.map.setFilter("pl-sel", ["==", ["get", "id"], id]);
      if (fly !== false) {
        const shortLand = isPhone() && innerHeight <= 500 && innerWidth > innerHeight;
        const pad = shortLand ? { top: 60, bottom: 20, left: 20, right: Math.round(Math.min(380, innerWidth * 0.52)) + 30 }
          : isPhone() ? { top: 70, bottom: Math.round(innerHeight * 0.55), left: 30, right: 30 }
          // desktop: the pin sits low enough for the pop-up that hangs above it (about 420 px with the forecast strip)
          : { top: Math.min(450, Math.round(innerHeight * 0.52)), bottom: 40, left: parseInt(getComputedStyle(document.documentElement).getPropertyValue("--panel-w")) + 40, right: 420 };
        state.map.flyTo({ center: [p.lon, p.lat], zoom: Math.max(state.map.getZoom(), 8.2), padding: pad, duration: reduce ? 0 : 1400, essential: true });
      }
    }
  }

  /* ---------- the pin pop-up: the 2025 shape Rose likes, restyled ---------- */
  let pop = null, popId = null;
  function showPop(id, fly) {
    const p = state.byId.get(id); if (!p || !state.mapReady) return;
    const ph = p.photos || []; let i = 0; popId = id;
    if (pop) pop.remove();
    const hero = ph.length ? `<img ${phAttrs(ph[0], "pop")} alt="${esc(p.name)}" onerror="this.style.display='none'">` +
      (ph.length > 1 ? '<button class="ph-nav prev" aria-label="Previous photo">&#8249;</button><button class="ph-nav next" aria-label="Next photo">&#8250;</button>' : "") +
      `<div class="credit">${credit(ph[0])}</div>`
      : `<div class="nophoto"><svg width="54" height="54" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2.5l3 10.5 10.5 3-10.5 3-3 10.5-3-10.5L2.5 16l10.5-3z" fill="${starColor(p.sky.stars)}"/></svg></div>`;
    const html = `<div class="pop" role="dialog" aria-label="${esc(p.name)}">
      <button class="x" aria-label="Close">&times;</button>
      <div class="hero">${hero}</div>
      <div class="pb"><div class="pt">${esc(p.name)}</div>
        <div class="pr">${starsSvg(p.sky.stars)}<span>${Math.round(p.sky.pct)}% OF STARS</span></div>
        ${amenStrip(p) ? `<div class="amen" style="justify-content:center">${amenStrip(p)}</div>` : ""}
        <div class="wx-slot"></div>
        <div class="pa">${p.url ? `<a class="btn primary" href="${esc(p.url)}" target="_blank" rel="noopener">Open Park Page</a>` : ""}<button class="btn" data-details>Details</button></div></div></div>`;
    const phone = isPhone();
    pop = new maplibregl.Popup({ className: "sf-pop", closeButton: false, maxWidth: "none", offset: 14, focusAfterOpen: false, ...(phone ? { anchor: "bottom" } : {}) })
      .setLngLat([p.lon, p.lat]).setHTML(html).addTo(state.map);
    document.body.classList.add("pop-open");
    pop.on("close", () => document.body.classList.remove("pop-open"));
    const el = pop.getElement();
    if (window.SFWeather) window.SFWeather.mount(el.querySelector(".wx-slot"), p, "mini");
    warm(ph, "pop");
    el.querySelector(".x").addEventListener("click", () => pop && pop.remove());
    el.querySelector("[data-details]").addEventListener("click", () => select(id, false));
    el.querySelectorAll(".ph-nav").forEach((b) => b.addEventListener("click", () => {
      i = (i + (b.classList.contains("next") ? 1 : -1) + ph.length) % ph.length;
      setPh(el.querySelector(".hero img"), ph[i], "pop"); el.querySelector(".hero .credit").innerHTML = credit(ph[i]); }));
    $$(".row").forEach((r) => (r.dataset.id === id ? r.setAttribute("aria-current", "true") : r.removeAttribute("aria-current")));
    state.map.setFilter("pl-sel", ["==", ["get", "id"], id]);
    // On a phone the pop-up hangs above its pin and must clear the floating search bar: cap it to the room there (it scrolls
    // inside if it is still taller), then put the pin just under it. Left to choose, MapLibre hung it below the pin on short
    // screens and its buttons fell off the bottom.
    let dy = 140;
    if (phone) {
      const box = el.querySelector(".pop"), top = 76, room = innerHeight - top - 30;
      box.style.maxHeight = room + "px";
      dy = Math.round(Math.min(innerHeight - 24, top + Math.min(box.offsetHeight, room) + 18) - innerHeight / 2);
    }
    if (fly) state.map.easeTo({ center: [p.lon, p.lat], zoom: Math.max(state.map.getZoom(), 7.2), offset: [0, dy], duration: reduce ? 0 : 900 });
  }

  function syncToggles() {
    $$("[data-filter]").forEach((b) => b.setAttribute("aria-pressed", String(!!state.filters[b.dataset.filter])));
    $$("[data-amen]").forEach((b) => b.setAttribute("aria-pressed", String(state.amenOn.has(b.dataset.amen))));
  }

  /* ---------- the phone drawer and the layer menu ---------- */
  function setDrawer(open) {
    $("#panel").classList.toggle("open", open);
    document.body.classList.toggle("drawer-open", open);
    $("#burger").setAttribute("aria-expanded", String(open));
    $("#burger").setAttribute("aria-label", open ? "Close the list of places" : "Open the list of places");
    $("#burgerIcon").setAttribute("d", open ? "M6 6l12 12M18 6L6 18" : "M4 7h16M4 12h16M4 17h16");
    if (open) { select(null); }
  }
  function setLayers(open) { $("#layersPop").hidden = !open; $("#layersBtn").setAttribute("aria-expanded", String(open)); }

  /* ---------- the map ---------- */
  function recolor(map) {
    const st = map.getStyle(); if (!st) return;
    for (const l of st.layers) {
      const id = l.id.toLowerCase();
      try {
        if (l.type === "background") map.setPaintProperty(l.id, "background-color", "#0b0820");
        else if (l.type === "fill" && /water|ocean|lake|river/.test(id)) map.setPaintProperty(l.id, "fill-color", "#100b2c");
        else if (l.type === "fill") { map.setPaintProperty(l.id, "fill-color", "#151030"); map.setPaintProperty(l.id, "fill-opacity", 0.35); }
        else if (l.type === "line" && /water|river|stream|canal/.test(id)) map.setPaintProperty(l.id, "line-color", "#1d1650");
        else if (l.type === "line" && /boundary|admin/.test(id)) map.setPaintProperty(l.id, "line-color", "rgba(196,170,255,0.38)");
        else if (l.type === "line") map.setPaintProperty(l.id, "line-color", "rgba(150,132,215,0.20)");
        else if (l.type === "symbol") { map.setPaintProperty(l.id, "text-color", "#b8acd8"); map.setPaintProperty(l.id, "text-halo-color", "#0b0820"); }
        else if (l.type === "fill-extrusion") map.setLayoutProperty(l.id, "visibility", "none");
      } catch (e) { /* a layer without that property: leave it */ }
    }
  }
  function firstSymbol(map) { const l = map.getStyle().layers.find((x) => x.type === "symbol"); return l && l.id; }
  /* The burn-ban badge beside a map dot (app/burnban.js draws it). Shown from zoom 6.4, where the place names appear: at the
     state-wide view the dots' job is the sky, and 60-odd badges would bury the colour that says how dark it is; once you are
     choosing between nearby places, whether you may have a fire is part of the choice. Anchored to the dot's upper right so it
     never covers the dot's colour or the name under it. Drawn at the screen's pixel ratio so it stays crisp on a phone. */
  function addBanBadges(map) {
    if (!window.SFBurn) return;
    const pr = Math.max(1, Math.min(3, Math.ceil(window.devicePixelRatio || 1))), px = 20 * pr, img = new Image(px, px);
    img.onload = () => {
      try {
        if (!map.hasImage("sf-ban")) map.addImage("sf-ban", img, { pixelRatio: pr });
        if (!map.getLayer("pl-ban")) map.addLayer({ id: "pl-ban", type: "symbol", source: "places", minzoom: 6.4, filter: ["in", ["get", "id"], ["literal", []]],
          layout: { "icon-image": "sf-ban", "icon-size": ["interpolate", ["linear"], ["zoom"], 6.4, 0.85, 9, 1], "icon-anchor": "bottom-left", "icon-offset": [1, -2],
            "icon-allow-overlap": true, "icon-ignore-placement": true } }, "pl-label");
        banFilter();
      } catch (e) { /* the badge is a second telling: the list, the pop-up and the card carry the mark */ }
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(window.SFBurn.badgeSvg(px));
  }

  function initMap() {
    if (!window.maplibregl) { $("#count").textContent += " · the map could not load, the list still works"; return; }
    const map = new maplibregl.Map({
      container: "map", style: "https://tiles.openfreemap.org/styles/dark", center: [-99.3, 31.2], zoom: 1.6,
      attributionControl: { compact: true, customAttribution: 'Sky glow: StarFinder model from NASA Black Marble (VIIRS)' },
      maxPitch: 0, dragRotate: false, pitchWithRotate: false, touchPitch: false, renderWorldCopies: false,
    });
    state.map = map;
    try { if (window.SurgeSpace) window.SurgeSpace.attach(map, $("#space")); } catch (e) { /* decoration only */ }
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.on("style.load", () => {
      try { map.setProjection({ type: "globe" }); } catch (e) {}
      recolor(map);
      const before = firstSymbol(map);
      map.addSource("sky", { type: "raster", tiles: [new URL("tiles/sky/{z}/{x}/{y}.png", location.href).href.replace(/%7B/g, "{").replace(/%7D/g, "}")],
        tileSize: 256, minzoom: 4, maxzoom: 9, bounds: [-110.25, 20.25, -87.75, 40.5], attribution: "" });
      map.addLayer({ id: "sky", type: "raster", source: "sky", paint: { "raster-opacity": 0.85, "raster-fade-duration": 200, "raster-resampling": "linear" } }, before);
      map.addSource("lights", { type: "raster", tileSize: 256, maxzoom: 8,
        tiles: ["https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_GapFilled_BRDF_Corrected_DayNightBand_Radiance/default/2026-10-28/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png"],
        attribution: "Satellite lights: NASA GIBS" });
      map.addLayer({ id: "lights", type: "raster", source: "lights", layout: { visibility: "none" }, paint: { "raster-opacity": 0.75 } }, before);
      const fc = { type: "FeatureCollection", features: state.places.map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: [p.lon, p.lat] },
        properties: { id: p.id, name: p.name, col: starColor(p.sky.stars), stars: p.sky.stars } })) };
      map.addSource("places", { type: "geojson", data: fc });
      map.addLayer({ id: "pl-glow", type: "circle", source: "places", paint: { "circle-color": ["get", "col"], "circle-blur": 1,
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 6, 7, 14, 11, 22], "circle-opacity": 0.55 } });
      map.addLayer({ id: "pl-core", type: "circle", source: "places", paint: { "circle-color": ["get", "col"],
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 2.6, 7, 4.5, 11, 7], "circle-stroke-color": "#0b0820", "circle-stroke-width": 1 } });
      map.addLayer({ id: "pl-sel", type: "circle", source: "places", filter: ["==", ["get", "id"], ""], paint: { "circle-color": "rgba(0,0,0,0)",
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 9, 11, 16], "circle-stroke-color": "#f2c45a", "circle-stroke-width": 2.2 } });
      map.addLayer({ id: "pl-label", type: "symbol", source: "places", minzoom: 6.4, layout: { "text-field": ["get", "name"], "text-size": 12.5,
        "text-offset": [0, 1.2], "text-anchor": "top", "text-max-width": 9, "text-font": ["Noto Sans Regular"] },
        paint: { "text-color": "#efe9ff", "text-halo-color": "#0b0820", "text-halo-width": 1.4 } });
      addBanBadges(map);
      state.mapReady = true; renderList();
      if (state.sel) select(state.sel, true);
      else if (!reduce) setTimeout(() => map.flyTo({ center: [-99.6, 31.1], zoom: isPhone() ? 4.3 : 5.15, padding: isPhone() ? {} : { left: 380 }, duration: 2600, essential: true }), 350);
      else map.jumpTo({ center: [-99.6, 31.1], zoom: isPhone() ? 4.3 : 5.15 });
    });
    for (const id of ["pl-core", "pl-glow"]) {
      map.on("click", id, (e) => { const f = e.features && e.features[0]; if (f) showPop(f.properties.id, true); });
      map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
    }
    map.on("moveend", () => { if (state.sort === "near" && !state.me) renderList(); });
  }

  /* ---------- wiring ---------- */
  function wire() {
    const q = $("#q");
    q.addEventListener("input", () => { state.q = q.value; $("#qClear").hidden = !q.value; if (isPhone() && q.value) setDrawer(true); renderList(); });
    const goFirst = () => { const f = visible()[0]; if (f) { if (isPhone()) { setDrawer(false); showPop(f.id, true); } else select(f.id, true); } };
    q.addEventListener("keydown", (e) => { if (e.key === "Enter") goFirst(); });
    $("#qGo").addEventListener("click", goFirst);
    $("#qClear").addEventListener("click", () => { q.value = ""; state.q = ""; $("#qClear").hidden = true; renderList(); q.focus(); });
    // the amenity toggles are made from AMEN, the same list the icon strips use: one owner for the icons, labels and order.
    // Each says in its title how many places have it, so a toggle that would empty the list is known before it is pressed.
    $("#amenFilters").innerHTML = AMEN.map(([k, ic, label, amp]) =>
      `<button class="chip ic${amp ? " amp" : ""}" type="button" data-amen="${k}" aria-pressed="false" aria-label="${label}" title="${label}">${IC[ic]}${amp || ""}</button>`).join("");
    $$("[data-amen]").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.amen; state.amenOn.has(k) ? state.amenOn.delete(k) : state.amenOn.add(k); syncToggles(); renderList(); }));
    $$("[data-filter]").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.filter; state.filters[k] = !state.filters[k]; syncToggles(); renderList(); }));
    $("#fClear").addEventListener("click", () => {
      state.amenOn.clear(); Object.keys(state.filters).forEach((k) => (state.filters[k] = false)); state.agency = "all"; $("#agency").value = "all";
      syncToggles(); renderList(); });
    // one row that scrolls sideways (her order: Dark Sky Places, every icon, then the rest). A mouse wheel moves it sideways while
    // the pointer is on it, and the fade at the right edge goes away once the end is reached, so the hint never hides the last chip.
    const row = $(".chips");
    row.addEventListener("wheel", (e) => {
      if (row.scrollWidth <= row.clientWidth + 1 || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      row.scrollLeft += e.deltaY; e.preventDefault(); }, { passive: false });
    const atEnd = () => row.classList.toggle("at-end", row.scrollLeft + row.clientWidth >= row.scrollWidth - 2);
    row.addEventListener("scroll", atEnd, { passive: true }); addEventListener("resize", atEnd); requestAnimationFrame(atEnd);
    $("#agency").addEventListener("change", (e) => { state.agency = e.target.value; renderList(); });
    $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; renderList(); });
    $("#list").addEventListener("click", (e) => { const b = e.target.closest(".row"); if (!b) return;
      if (isPhone()) { setDrawer(false); showPop(b.dataset.id, true); } else { select(b.dataset.id, true); setTimeout(() => showPop(b.dataset.id, false), reduce ? 0 : 1450); } });
    $("#burger").addEventListener("click", () => setDrawer(!$("#panel").classList.contains("open")));
    $("#layersBtn").addEventListener("click", () => setLayers($("#layersPop").hidden));
    $$("[data-layer]").forEach((t) => t.addEventListener("click", () => {
      const on = t.getAttribute("aria-checked") !== "true"; t.setAttribute("aria-checked", String(on)); const m = state.map; if (!state.mapReady) return;
      if (t.dataset.layer === "globe") m.setProjection({ type: on ? "globe" : "mercator" });
      else m.setLayoutProperty(t.dataset.layer, "visibility", on ? "visible" : "none");
    }));
    $("#skyOpacity").addEventListener("input", (e) => { if (state.mapReady) state.map.setPaintProperty("sky", "raster-opacity", e.target.value / 100); });
    $("#locateBtn").addEventListener("click", () => {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition((pos) => {
        state.me = { lat: pos.coords.latitude, lon: pos.coords.longitude }; state.sort = "near"; $("#sort").value = "near"; renderList();
        if (isPhone()) setDrawer(true);
        if (state.mapReady) state.map.flyTo({ center: [state.me.lon, state.me.lat], zoom: 7, duration: reduce ? 0 : 1200 });
      }, () => { $("#count").textContent = "Location was not shared, so distances are from the map's centre."; }, { maximumAge: 600000, timeout: 10000 });
    });
    const about = $("#about");
    $$("[data-about]").forEach((b) => b.addEventListener("click", () => about.showModal()));
    $("#aboutClose").addEventListener("click", () => about.close());
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!$("#layersPop").hidden) setLayers(false);
      else if (pop && pop.isOpen()) pop.remove();
      else if (!$("#card").hidden) select(null);
      else if ($("#panel").classList.contains("open")) setDrawer(false);
    });
    document.addEventListener("click", (e) => { if (!$("#layersPop").hidden && !e.target.closest("#toolbar")) setLayers(false); });
    document.addEventListener("keydown", (e) => {   // "/" jumps to the search, as on most map sites
      const a = document.activeElement;
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable))) return;
      e.preventDefault(); $("#q").focus();
    });
  }

  /* ---------- the glass catches the light: the pointer is the light source (hover devices only) ---------- */
  function glassLight() {
    if (reduce || !matchMedia("(hover: hover)").matches) return;
    let raf = 0, px = 0, py = 0;
    const paint = () => {
      raf = 0; const els = $$(".lg"), rects = els.map((g) => g.getBoundingClientRect());   // all reads, then all writes
      els.forEach((g, i) => { const r = rects[i]; if (!r.width) return;
        g.style.setProperty("--mx", (((px - r.left) / r.width) * 100).toFixed(1) + "%"); g.style.setProperty("--my", (((py - r.top) / r.height) * 100).toFixed(1) + "%"); });
    };
    addEventListener("pointermove", (e) => { px = e.clientX; py = e.clientY; if (!raf) raf = requestAnimationFrame(paint); }, { passive: true });
  }

  async function start() {
    document.body.insertAdjacentHTML("afterbegin", '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><clipPath id="sfHalf" clipPathUnits="userSpaceOnUse"><rect x="0" y="0" width="12" height="24"/></clipPath></defs></svg>');
    if (navigator.userAgentData) document.documentElement.classList.add("warp");   // Chromium only: see html.warp in the CSS
    const bk = $("#banKey"); if (bk && window.SFBurn) bk.insertAdjacentHTML("afterbegin", window.SFBurn.badgeSvg(18).replace("<svg ", '<svg aria-hidden="true" ')); else if (bk) bk.remove();   // the map badge's key: the badge itself
    wire(); glassLight();
    try {
      const pl = await (window.__sfPlaces || fetch("data/places.json").then((r) => r.json()));
      // a place whose own page says no camping is kept in the data with its reason ("listed": false, tools/camping_delist.py)
      // and left off the map and the list: every dot is somewhere you can camp, or whose page does not say
      state.places = pl.places.filter((p) => p.listed !== false); state.places.forEach((p) => state.byId.set(p.id, p));
    } catch (e) { $("#count").textContent = "The list of places could not load. Serve this folder over http rather than opening the file directly."; }
    // the burn-ban file is tiny and not needed for the first paint: ask for it now, fill the card line when it lands (no-cache = revalidate, so a new 6-hourly file is not hidden by the CDN's 10 minutes)
    fetch("data/burnbans.json", { cache: "no-cache" }).then((r) => r.ok ? r.json() : null).catch(() => null)
      .then((b) => { state.burn = b; state.burnDone = true; burnRefresh(); });
    const m = location.hash.match(/p=([\w-]+)/); if (m && state.byId.has(m[1])) state.sel = m[1];
    const fm = location.hash.match(/f=([\w.]+)/);   // filters from a shared link, read before the first render writes the hash back
    if (fm) for (const k of fm[1].split(".")) {
      if (k in state.filters) state.filters[k] = true; else if (AMEN.some(([a]) => a === k)) state.amenOn.add(k);
    }
    syncToggles();
    for (const [k, , label] of AMEN) { const b = $(`[data-amen="${k}"]`); if (b) b.title = `${label}: ${state.places.filter((p) => p.amen && p.amen[k] === true).length} places`; }
    renderList(); if (state.sel) select(state.sel, false);
    // the list is on screen now; the map starts when MapLibre (a large script, loaded beside the page) has arrived. initMap says so if it never does.
    const ml = $("#mlScript");
    if (window.maplibregl || !ml) initMap(); else { ml.addEventListener("load", initMap, { once: true }); ml.addEventListener("error", initMap, { once: true }); }
  }
  start();
})();

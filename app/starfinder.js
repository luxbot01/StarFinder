/* StarFinder app. Plain JavaScript, no build step. Data: data/places.json (park facts + modelled sky),
   data/photos.json (Wikimedia Commons links carried over from the 2025 version), tiles/sky (our model). */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isPhone = () => matchMedia("(max-width: 899px)").matches;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const state = { places: [], byId: new Map(), photos: {}, filters: { camping: false, darksky: false, four: false },
    agency: "all", sort: "dark", q: "", sel: null, me: null, map: null, mapReady: false };
  window.__sf = state;   // read-only handle for the test harness

  /* ---------- the sky behind the globe: drawn once, two planes ---------- */
  function drawSky() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    [["#starsFar", 0.00042, 0.6, 0.5], ["#starsNear", 0.00009, 1.25, 0.9]].forEach(([sel, density, rMax, aMax], k) => {
      const c = $(sel); const w = innerWidth, h = innerHeight;
      c.width = w * dpr; c.height = h * dpr; const g = c.getContext("2d"); g.scale(dpr, dpr);
      let seed = 7 + k * 101; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const n = Math.round(w * h * density);
      for (let i = 0; i < n; i++) {
        const x = rnd() * w, y = rnd() * h, r = 0.25 + rnd() ** 3 * rMax, t = rnd();
        const col = t < 0.15 ? "255,214,170" : t < 0.3 ? "190,205,255" : "245,240,255";
        g.fillStyle = `rgba(${col},${(0.25 + rnd() * aMax).toFixed(2)})`;
        g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill();
      }
    });
  }

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
  const starColor = (s) => s >= 4.5 ? "#e6eeff" : s >= 3.5 ? "#b8c6ff" : s >= 2.5 ? "#b49cff" : s >= 1.5 ? "#f2a2cf" : "#ffb071";
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

  /* ---------- filtering, sorting and the list ---------- */
  function visible() {
    const q = state.q.trim().toLowerCase(), f = state.filters;
    let out = state.places.filter((p) =>
      (!f.camping || p.camping === true) && (!f.darksky || p.darkSky) && (!f.four || p.sky.stars >= 4) &&
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
    $("#count").textContent = `${items.length} of ${state.places.length} places${where}`;
    ul.innerHTML = items.map((p) => {
      const sub = [p.type, p.town || p.county].filter(Boolean).join(" · ") + (state.sort === "near" ? ` · ${mi(p._d)} mi` : "");
      return `<li><button class="row" data-id="${esc(p.id)}"${state.sel === p.id ? ' aria-current="true"' : ""}>
        <svg class="dot" viewBox="0 0 30 30" aria-hidden="true"><circle cx="15" cy="15" r="11" fill="${starColor(p.sky.stars)}" opacity=".16"/><path d="M15 5.5l1.7 7.8 7.8 1.7-7.8 1.7L15 24.5l-1.7-7.8L5.5 15l7.8-1.7z" fill="${starColor(p.sky.stars)}"/></svg>
        <span class="nm">${esc(p.name)}</span>
        <span class="rate">${starsSvg(p.sky.stars)}<span class="pct">${Math.round(p.sky.pct)}% of stars</span></span>
        <span class="sub">${esc(sub)}${p.camping ? " · camping" : ""}${p.darkSky ? " · Dark Sky Place" : ""}</span>
      </button></li>`;
    }).join("") || `<li class="count" style="padding:12px">No place matches. Clear a filter or the search.</li>`;
    if (state.mapReady) state.map.setFilter("pl-core", ["in", ["get", "id"], ["literal", items.map((p) => p.id)]]);
    if (state.mapReady) state.map.setFilter("pl-glow", ["in", ["get", "id"], ["literal", items.map((p) => p.id)]]);
  }

  /* ---------- the place card ---------- */
  function darkerNearby(p) {
    return state.places.filter((o) => o !== p && o.sky.pct >= p.sky.pct + 8)
      .map((o) => ({ o, d: km(p, o) })).filter((x) => x.d <= 200).sort((a, b) => a.d - b.d).slice(0, 3);
  }
  function renderCard(p) {
    const s = p.sky, card = $("#card"), photos = state.photos[p.id] || [];
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
        ${photos.length ? `<figure class="photo" style="margin:0"><img id="ph" src="${esc(photos[0])}?width=800" alt="${esc(p.name)}" loading="lazy" onerror="this.closest('figure').hidden=true"><figcaption>Photo: Wikimedia Commons</figcaption>${photos.length > 1 ? `<div class="nav"><button data-ph="-1" aria-label="Previous photo">&#8249;</button><button data-ph="1" aria-label="Next photo">&#8250;</button></div>` : ""}</figure>` : ""}
        ${p.blurb ? `<p>${esc(p.blurb)}</p>` : ""}
        ${p.status ? `<p class="note">${esc(p.status)}</p>` : ""}
        <div><h3>Staying the night</h3><div class="tags">${camp}</div></div>
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
    let pi = 0;
    $$("[data-ph]", card).forEach((b) => b.addEventListener("click", () => { pi = (pi + +b.dataset.ph + photos.length) % photos.length; $("#ph").src = photos[pi] + "?width=800"; }));
    $("#cardClose").addEventListener("click", () => select(null));
    $$("[data-go]", card).forEach((b) => b.addEventListener("click", () => select(b.dataset.go, true)));
  }

  function select(id, fly) {
    state.sel = id; const card = $("#card");
    $$(".row").forEach((r) => (r.dataset.id === id ? r.setAttribute("aria-current", "true") : r.removeAttribute("aria-current")));
    if (!id) {
      card.hidden = true; document.body.classList.remove("card-open");
      if (state.mapReady) state.map.setFilter("pl-sel", ["==", ["get", "id"], ""]);
      history.replaceState(null, "", location.pathname + location.search); return;
    }
    const p = state.byId.get(id); if (!p) return;
    renderCard(p); card.hidden = false; document.body.classList.add("card-open");
    if (!reduce) { card.classList.add("enter"); requestAnimationFrame(() => requestAnimationFrame(() => card.classList.remove("enter"))); }
    history.replaceState(null, "", "#p=" + encodeURIComponent(id));
    if (isPhone()) setDrawer(false);
    if (state.mapReady) {
      state.map.setFilter("pl-sel", ["==", ["get", "id"], id]);
      if (fly !== false) {
        const shortLand = isPhone() && innerHeight <= 500 && innerWidth > innerHeight;
        const pad = shortLand ? { top: 60, bottom: 20, left: 20, right: Math.round(Math.min(380, innerWidth * 0.52)) + 30 }
          : isPhone() ? { top: 70, bottom: Math.round(innerHeight * 0.55), left: 30, right: 30 }
          : { top: 60, bottom: 60, left: parseInt(getComputedStyle(document.documentElement).getPropertyValue("--panel-w")) + 40, right: 420 };
        state.map.flyTo({ center: [p.lon, p.lat], zoom: Math.max(state.map.getZoom(), 8.2), padding: pad, duration: reduce ? 0 : 1400, essential: true });
      }
    }
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

  function initMap() {
    if (!window.maplibregl) { $("#count").textContent += " · the map could not load, the list still works"; return; }
    const map = new maplibregl.Map({
      container: "map", style: "https://tiles.openfreemap.org/styles/dark", center: [-99.3, 31.2], zoom: 1.6,
      attributionControl: { compact: true, customAttribution: 'Sky glow: StarFinder model from NASA Black Marble (VIIRS)' },
      maxPitch: 0, dragRotate: false, pitchWithRotate: false, touchPitch: false, renderWorldCopies: false,
    });
    state.map = map;
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
      state.mapReady = true; renderList();
      if (state.sel) select(state.sel, true);
      else if (!reduce) setTimeout(() => map.flyTo({ center: [-99.6, 31.1], zoom: isPhone() ? 4.3 : 5.15, padding: isPhone() ? {} : { left: 380 }, duration: 2600, essential: true }), 350);
      else map.jumpTo({ center: [-99.6, 31.1], zoom: isPhone() ? 4.3 : 5.15 });
    });
    for (const id of ["pl-core", "pl-glow"]) {
      map.on("click", id, (e) => { const f = e.features && e.features[0]; if (f) select(f.properties.id, true); });
      map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
    }
    map.on("moveend", () => { if (state.sort === "near" && !state.me) renderList(); });
  }

  /* ---------- wiring ---------- */
  function wire() {
    const q = $("#q");
    q.addEventListener("input", () => { state.q = q.value; $("#qClear").hidden = !q.value; if (isPhone() && q.value) setDrawer(true); renderList(); });
    q.addEventListener("keydown", (e) => { if (e.key === "Enter") { const f = visible()[0]; if (f) select(f.id, true); } });
    $("#qClear").addEventListener("click", () => { q.value = ""; state.q = ""; $("#qClear").hidden = true; renderList(); q.focus(); });
    $$("[data-filter]").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.filter; state.filters[k] = !state.filters[k]; b.setAttribute("aria-pressed", String(state.filters[k])); renderList(); }));
    $("#agency").addEventListener("change", (e) => { state.agency = e.target.value; renderList(); });
    $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; renderList(); });
    $("#list").addEventListener("click", (e) => { const b = e.target.closest(".row"); if (b) select(b.dataset.id, true); });
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
      else if (!$("#card").hidden) select(null);
      else if ($("#panel").classList.contains("open")) setDrawer(false);
    });
    document.addEventListener("click", (e) => { if (!$("#layersPop").hidden && !e.target.closest("#toolbar")) setLayers(false); });
    addEventListener("resize", () => { clearTimeout(wire.t); wire.t = setTimeout(drawSky, 200); });
  }

  async function start() {
    document.body.insertAdjacentHTML("afterbegin", '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><clipPath id="sfHalf" clipPathUnits="userSpaceOnUse"><rect x="0" y="0" width="12" height="24"/></clipPath></defs></svg>');
    drawSky(); wire();
    try {
      const [pl, ph] = await Promise.all([fetch("data/places.json").then((r) => r.json()), fetch("data/photos.json").then((r) => r.json()).catch(() => ({}))]);
      state.places = pl.places; state.photos = ph; state.places.forEach((p) => state.byId.set(p.id, p));
    } catch (e) { $("#count").textContent = "The list of places could not load. Serve this folder over http rather than opening the file directly."; }
    const m = location.hash.match(/p=([\w-]+)/); if (m && state.byId.has(m[1])) state.sel = m[1];
    renderList(); if (state.sel) select(state.sel, false);
    initMap();
  }
  start();
})();

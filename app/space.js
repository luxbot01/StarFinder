/* Surge — the sky behind the globe.
 *
 * Drawn once per window size onto two canvases (a horizontally seamless strip, so the
 * sky can slide as the globe turns), plus a few dozen CSS-animated stars for twinkle.
 * No per-frame JavaScript, no images to download: everything here is generated from a
 * seed in about a hundred milliseconds. Decoration only — if anything throws, the page
 * keeps its plain dark ground and the map is untouched.
 *
 * What is in it, back to front: a deep violet ground; a Milky Way band with a warm core,
 * blue-white edges and dark dust lanes; three nebulae (amethyst, rose, teal); a few
 * distant galaxies; ~5,000 stars coloured by spectral class, denser inside the band;
 * the brightest with a soft halo and diffraction spikes.
 */
(function () {
  'use strict';

  var REDUCE = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- deterministic randomness -------------------------------------------------
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Value noise that wraps horizontally with period `px` lattice cells, so the strip is seamless.
  function makeNoise(seed, px) {
    var r = rng(seed), N = 512, perm = new Uint16Array(N * 2), val = new Float32Array(N);
    for (var i = 0; i < N; i++) { perm[i] = i; val[i] = r(); }
    for (i = N - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)), t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
    for (i = 0; i < N; i++) perm[i + N] = perm[i];
    function lat(x, y, period) { x = ((x % period) + period) % period; return val[perm[(perm[x & 511] + y) & 1023] & 511]; }
    function sm(t) { return t * t * (3 - 2 * t); }
    function noise(x, y, period) {
      var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      var a = lat(xi, yi, period), b = lat(xi + 1, yi, period), c = lat(xi, yi + 1, period), d = lat(xi + 1, yi + 1, period);
      var u = sm(xf), v = sm(yf);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }
    return function fbm(x, y, oct) {
      var sum = 0, amp = 0.5, f = 1, norm = 0;
      for (var o = 0; o < oct; o++) {
        sum += amp * noise(x * f, y * f, px * f); norm += amp; amp *= 0.5; f *= 2;
      }
      return sum / norm;
    };
  }

  // Spectral-class star colours, in the photographic (saturated) order the cosmic site uses.
  var STAR = [
    [155, 176, 255], [170, 191, 255], [202, 215, 255], [248, 247, 255],
    [255, 244, 234], [255, 225, 190], [255, 204, 150], [255, 180, 120]
  ];
  var STAR_W = [0.05, 0.10, 0.17, 0.22, 0.18, 0.13, 0.09, 0.06];
  function pickStar(r) {
    var x = r(), acc = 0;
    for (var i = 0; i < STAR.length; i++) { acc += STAR_W[i]; if (x <= acc) return STAR[i]; }
    return STAR[3];
  }

  function paint(W, H, dpr) {
    var cw = Math.round(W * dpr), ch = Math.round(H * dpr);
    var c = document.createElement('canvas'); c.width = cw; c.height = ch;
    var g = c.getContext('2d');
    var r = rng(20260923);

    // 1. ground
    var bg = g.createLinearGradient(0, 0, 0, ch);
    bg.addColorStop(0, '#05040c'); bg.addColorStop(0.55, '#090716'); bg.addColorStop(1, '#0c0a1e');
    g.fillStyle = bg; g.fillRect(0, 0, cw, ch);

    // 2. clouds: galaxy band + nebulae, computed at 1/5 resolution and smoothed up.
    var nw = Math.ceil(W / 5), nh = Math.ceil(H / 5);
    var lo = document.createElement('canvas'); lo.width = nw; lo.height = nh;
    var lg = lo.getContext('2d'), img = lg.createImageData(nw, nh), px = img.data;
    var cells = 6;                                   // noise lattice cells across the strip
    var fA = makeNoise(11, cells), fB = makeNoise(29, cells * 2), fC = makeNoise(47, cells);
    var neb = [
      { x: 0.18, y: 0.30, rx: 0.17, ry: 0.24, col: [140, 72, 255], k: 1.25 },   // amethyst
      { x: 0.62, y: 0.80, rx: 0.15, ry: 0.17, col: [255, 70, 150], k: 1.05 },   // rose
      { x: 0.86, y: 0.20, rx: 0.13, ry: 0.16, col: [40, 210, 200], k: 0.85 }    // teal
    ];
    var phase = r() * Math.PI * 2;
    for (var y = 0; y < nh; y++) {
      var v = y / nh;
      for (var x = 0; x < nw; x++) {
        var u = x / nw;
        var nx = u * cells, ny = v * cells * (nh / nw);
        // the band: a slow sine across the strip, width breathing with noise
        var centre = 0.50 + 0.30 * Math.sin(u * Math.PI * 2 + phase);
        var wob = fC(nx, ny, 3) - 0.5;
        var d = (v - centre - wob * 0.10) / (0.13 + 0.05 * fA(nx + 3 * cells, ny + 3, 2));
        var band = Math.exp(-d * d);
        var cloud = fA(nx, ny, 5);
        var dust = fB(nx * 2, ny * 2, 5);
        var grain = fB(nx * 2 + 5 * cells * 2, ny * 2, 4);
        var lum = band * (0.6 * Math.pow(cloud, 1.3) + 0.55 * Math.pow(grain, 2.2)) * 2.7 + Math.exp(-d * d * 9) * cloud * 0.9;
        var lane = band * Math.max(0, dust - 0.5) * 3.6;            // dark dust lanes
        lum = Math.max(0, lum - lane);
        // warm core -> cool edges
        var warm = Math.exp(-d * d * 3.5);
        var R = lum * (150 + 105 * warm), G = lum * (160 + 62 * warm), B = lum * (230 - 60 * warm);
        for (var k = 0; k < neb.length; k++) {
          var n = neb[k], du = u - n.x; if (du > 0.5) du -= 1; if (du < -0.5) du += 1;
          var dx = du / n.rx, dy = (v - n.y) / n.ry;
          var e = Math.exp(-(dx * dx + dy * dy) * 1.4);
          if (e < 0.004) continue;
          var sh = Math.pow(fB(nx * 2 + k * 7, ny * 2 - k * 5, 5), 1.8) * 2.4;
          var a = e * sh * n.k;
          R += a * n.col[0]; G += a * n.col[1]; B += a * n.col[2];
        }
        var i = (y * nw + x) * 4;
        px[i] = Math.min(255, R); px[i + 1] = Math.min(255, G); px[i + 2] = Math.min(255, B);
        px[i + 3] = Math.min(255, Math.max(R, G, B) * 1.15);
      }
    }
    lg.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.8;
    g.drawImage(lo, 0, 0, cw, ch);
    g.globalAlpha = 1;

    // 3. distant galaxies: a handful of tilted smudges
    for (var q = 0; q < 7; q++) {
      var gx = r() * cw, gy = r() * ch, gs = (6 + r() * 14) * dpr, ang = r() * Math.PI;
      g.save(); g.translate(gx, gy); g.rotate(ang); g.scale(1, 0.32 + r() * 0.3);
      var gg = g.createRadialGradient(0, 0, 0, 0, 0, gs);
      gg.addColorStop(0, 'rgba(255,236,210,0.55)'); gg.addColorStop(0.35, 'rgba(210,190,255,0.16)'); gg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gg; g.beginPath(); g.arc(0, 0, gs, 0, Math.PI * 2); g.fill(); g.restore();
    }

    // 4. stars, denser inside the band. Most are dust-grain faint; brightness is ranked
    //    afterwards so only the top few dozen get halos and only the top handful get spikes
    //    (spikes on everything is the fastest way to make a sky look like clip art).
    var count = Math.round((cw * ch) / (240 * dpr * dpr));
    var all = [];
    for (var s = 0; s < count; s++) {
      var sx = r() * cw, sy = r() * ch;
      var su = sx / cw, sv = sy / ch;
      var cen = 0.50 + 0.30 * Math.sin(su * Math.PI * 2 + phase);
      var bd = (sv - cen) / 0.15, inBand = Math.exp(-bd * bd);
      if (r() > 0.18 + 0.82 * inBand && r() > 0.28) continue;       // thin the stars outside the band
      var m = Math.pow(r(), 7);                                     // a few bright, most faint
      var col = pickStar(r);
      var rad = (0.32 + m * 1.7) * dpr;
      var al = m > 0.05 ? 0.45 + m * 0.55 : 0.10 + r() * 0.38;
      g.fillStyle = 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + al.toFixed(3) + ')';
      if (rad < 0.9 * dpr) g.fillRect(sx, sy, Math.max(1, rad * 1.5), Math.max(1, rad * 1.5));
      else { g.beginPath(); g.arc(sx, sy, rad, 0, Math.PI * 2); g.fill(); }
      if (m > 0.2) all.push([sx, sy, m, col]);
    }
    all.sort(function (p, q) { return q[2] - p[2]; });
    var bright = all.slice(0, Math.round(70 * (cw * ch) / (2600 * 960 * dpr * dpr)) + 20);
    for (var b = 0; b < bright.length; b++) {
      var bx = bright[b][0], by = bright[b][1], bm = bright[b][2], bc = bright[b][3];
      var hr = (4 + bm * 16) * dpr, sl = (14 + bm * 30) * dpr, spike = b < 7;
      // a halo or spike that crosses the strip's edge is drawn again on the far side
      var reach = spike ? sl : hr;
      var offs = [0]; if (bx < reach) offs.push(cw); if (bx > cw - reach) offs.push(-cw);
      for (var oi = 0; oi < offs.length; oi++) {
        var ox = bx + offs[oi];
        var hg = g.createRadialGradient(ox, by, 0, ox, by, hr);
        hg.addColorStop(0, 'rgba(' + bc + ',0.5)'); hg.addColorStop(0.22, 'rgba(' + bc + ',0.12)'); hg.addColorStop(1, 'rgba(' + bc + ',0)');
        g.fillStyle = hg; g.beginPath(); g.arc(ox, by, hr, 0, Math.PI * 2); g.fill();
        if (spike) {                                                // diffraction spikes, tapered
          var lgx = g.createLinearGradient(ox - sl, by, ox + sl, by);
          lgx.addColorStop(0, 'rgba(' + bc + ',0)'); lgx.addColorStop(0.5, 'rgba(' + bc + ',0.42)'); lgx.addColorStop(1, 'rgba(' + bc + ',0)');
          g.fillStyle = lgx; g.fillRect(ox - sl, by - 0.5 * dpr, sl * 2, 1 * dpr);
          var lgy = g.createLinearGradient(ox, by - sl, ox, by + sl);
          lgy.addColorStop(0, 'rgba(' + bc + ',0)'); lgy.addColorStop(0.5, 'rgba(' + bc + ',0.42)'); lgy.addColorStop(1, 'rgba(' + bc + ',0)');
          g.fillStyle = lgy; g.fillRect(ox - 0.5 * dpr, by - sl, 1 * dpr, sl * 2);
        }
      }
    }
    g.globalCompositeOperation = 'source-over';
    return { canvas: c, bright: bright };
  }

  function attach(map, host) {
    if (!host || !map) return;
    var strip = document.createElement('div');
    strip.className = 'space-strip';
    host.appendChild(strip);
    // The air: a blue glow hugging the planet's edge, drawn BEHIND the map so the globe
    // itself covers its inner half. And the shading: a soft limb-darkening plus a sheen,
    // drawn OVER the map so the flat tiles read as a sphere lit from the upper left.
    var halo = document.createElement('div'); halo.className = 'space-halo'; host.appendChild(halo);
    // The light the globe's sheen implies: a warm wash from the upper left of the window.
    var sun = document.createElement('div'); sun.className = 'space-sun'; host.insertBefore(sun, strip.nextSibling);
    // And, every so often, a meteor. One element, a CSS keyframe; nothing when motion is reduced.
    if (!REDUCE) { var met = document.createElement('div'); met.className = 'space-meteor'; host.appendChild(met); }
    // (inserted right after the map's own canvas, so pins and popups added later paint above it)
    var cc = map.getCanvasContainer(), cv0 = map.getCanvas();
    // (inside a clip the size of the map, so the disc can be larger than a phone screen
    // without anything poking outside the window)
    var clip = document.createElement('div'); clip.className = 'globe-shade-clip'; clip.setAttribute('aria-hidden', 'true');
    var shade = document.createElement('div'); shade.className = 'globe-shade';
    clip.appendChild(shade);
    cc.insertBefore(clip, cv0.nextSibling);
    var W = 0, H = 0;

    // Where the globe's edge actually is on screen, measured rather than derived: walk a
    // meridian away from the centre and take the farthest point the map projects. Beyond
    // the horizon, perspective folds points back inward, so the maximum IS the limb.
    function limb() {
      var c = map.getCenter(), p0 = map.project(c), best = 0;
      var dir = c.lat <= 0 ? 1 : -1;
      for (var th = 40; th <= 90; th += 1) {
        var p = map.project([c.lng, c.lat + dir * th]);
        var d = Math.hypot(p.x - p0.x, p.y - p0.y);
        if (d > best) best = d;
      }
      return { x: p0.x, y: p0.y, r: best };
    }

    function build() {
      var rect = host.getBoundingClientRect();
      var h = Math.max(1, Math.round(rect.height) + 60), w = Math.max(1, Math.round(rect.width));   // +60: room to drift with latitude
      var tw = Math.max(w, Math.round(h * 1.8));                   // one tile of the strip
      if (Math.abs(tw - W) < 2 && Math.abs(h - H) < 2) return;
      W = tw; H = h;
      // capped at 1.5x: the strip is two full-height canvases, and a sky does not need retina
      // sharpness to be beautiful, but a phone does need the memory back
      var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      var t0 = performance.now();
      var p = paint(W, H, dpr);
      strip.innerHTML = '';
      strip.style.width = (W * 2) + 'px'; strip.style.height = H + 'px';
      for (var k = 0; k < 2; k++) {
        var cv = k === 0 ? p.canvas : document.createElement('canvas');
        if (k === 1) { cv.width = p.canvas.width; cv.height = p.canvas.height; cv.getContext('2d').drawImage(p.canvas, 0, 0); }
        cv.style.cssText = 'position:absolute;top:0;left:' + (k * W) + 'px;width:' + W + 'px;height:' + H + 'px';
        strip.appendChild(cv);
      }
      // twinkle: the brightest stars get a compositor-only CSS pulse (no JS per frame)
      if (!REDUCE) {
        var dpr2 = Math.min(window.devicePixelRatio || 1, 1.5);
        var pick = p.bright.slice(0, 56);
        for (k = 0; k < 2; k++) {
          for (var i = 0; i < pick.length; i++) {
            var s = document.createElement('i');
            s.className = 'tw';
            var sz = 2 + pick[i][2] * 3;
            s.style.cssText = 'left:' + (k * W + pick[i][0] / dpr2 - sz / 2) + 'px;top:' + (pick[i][1] / dpr2 - sz / 2) + 'px;' +
              'width:' + sz + 'px;height:' + sz + 'px;color:rgb(' + pick[i][3] + ');' +
              'animation-duration:' + (2.6 + (i * 0.73) % 4.4).toFixed(2) + 's;animation-delay:-' + ((i * 1.37) % 6).toFixed(2) + 's';
            strip.appendChild(s);
          }
        }
      }
      host.dataset.paintMs = Math.round(performance.now() - t0);
      place();
    }

    // The sky turns with the globe, a third as fast (it is much farther away), and fades
    // out as the planet fills the window.
    function place() {
      if (!W) return;
      var c = map.getCenter(), z = map.getZoom();
      var s = ((c.lng / 360) * W * 0.34) % W; if (s < 0) s += W;
      strip.style.transform = 'translate3d(' + (-s).toFixed(1) + 'px,' + (c.lat * 0.3).toFixed(1) + 'px,0)';
      var o = z <= 3 ? 1 : z >= 6 ? 0 : 1 - (z - 3) / 3;
      host.style.opacity = o.toFixed(3);
      host.style.visibility = o === 0 ? 'hidden' : 'visible';
      // the shading only makes sense while the whole disc is in view
      var so = z <= 2.6 ? 1 : z >= 4.2 ? 0 : 1 - (z - 2.6) / 1.6;
      if (so > 0 || o > 0) {
        var L = limb(), d = (L.r * 2).toFixed(1);
        halo.style.cssText = 'width:' + (L.r * 2.7).toFixed(1) + 'px;height:' + (L.r * 2.7).toFixed(1) + 'px;' +
          'transform:translate(' + (L.x - L.r * 1.35).toFixed(1) + 'px,' + (L.y - L.r * 1.35).toFixed(1) + 'px)';
        shade.style.cssText = 'width:' + d + 'px;height:' + d + 'px;opacity:' + so.toFixed(3) + ';' +
          'transform:translate(' + (L.x - L.r).toFixed(1) + 'px,' + (L.y - L.r).toFixed(1) + 'px)';
      } else {
        shade.style.opacity = '0';
      }
    }

    var t;
    window.addEventListener('resize', function () { clearTimeout(t); t = setTimeout(build, 180); });
    map.on('move', place);
    map.on('resize', place);
    map.on('load', place);
    try { build(); } catch (e) { host.style.display = 'none'; }
  }

  window.SurgeSpace = { attach: attach };
})();

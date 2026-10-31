# Turn the glow field into (1) sky-brightness tiles for the map and (2) StarFinder's places.json.
import os, json, math
import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates

MODEL = r"D:\StarFinderData\model"
REPO = r"C:\Users\luxbo\Documents\Code\StarFinder"
M = json.load(open(os.path.join(MODEL, "meta.json")))
G = np.load(os.path.join(MODEL, "g_3_100.npy"))
C = 0.06540936682759511          # scale fixed by the two published Bortle-3 anchors (probe.py, d0=3, L=100)
NAT_SQM = 22.0                   # natural zenith brightness, mag/arcsec^2
ratio = (G * C).astype(np.float32)
logr = np.log10(np.maximum(ratio, 1e-4)).astype(np.float32)

def sample(lat, lon, arr=logr):
    i = (M["lat0"] - lat) / M["deg"] - 0.5; j = (lon - M["lon0"]) / M["deg"] - 0.5
    return float(map_coordinates(arr, [[i], [j]], order=1, mode="nearest")[0])

def sky(r):
    sqm = NAT_SQM - 2.5 * math.log10(1 + r)
    nelm = 7.93 - 5 * math.log10(10 ** (4.316 - sqm / 5) + 1)          # naked-eye limiting magnitude
    nelm0 = 7.93 - 5 * math.log10(10 ** (4.316 - NAT_SQM / 5) + 1)
    pct = 100 * 10 ** (0.495 * (nelm - nelm0))                          # share of a pristine sky's stars
    stars = max(0.5, min(5.0, round(pct / 10) / 2))                     # half stars, 20 points each
    return sqm, nelm, pct, stars

# ---------- tiles ----------
STOPS = [(-1.7, (40, 30, 110, 0)), (-1.2, (52, 36, 140, 60)), (-0.8, (78, 44, 170, 95)),
         (-0.5, (118, 62, 200, 120)), (0.0, (186, 72, 196, 140)), (0.5, (238, 92, 150, 155)),
         (0.95, (255, 150, 72, 170)), (1.43, (255, 208, 112, 185)), (1.9, (255, 244, 222, 200))]
xs = np.array([s[0] for s in STOPS]); cols = np.array([s[1] for s in STOPS], np.float32)
def colour(lr):
    out = np.empty(lr.shape + (4,), np.float32)
    for k in range(4): out[..., k] = np.interp(lr, xs, cols[:, k])
    return out.astype(np.uint8)

def tiles(zmin=4, zmax=9, box=(-110.2, 20.3, -87.8, 40.45)):
    lon_a, lat_a, lon_b, lat_b = box; n_written = 0; total = 0
    for z in range(zmin, zmax + 1):
        n = 2 ** z
        def tx(lon): return int((lon + 180) / 360 * n)
        def ty(lat): return int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
        for x in range(tx(lon_a), tx(lon_b) + 1):
            for y in range(ty(lat_b), ty(lat_a) + 1):
                px = (x + (np.arange(256) + 0.5) / 256) / n * 360 - 180
                py = y + (np.arange(256) + 0.5) / 256
                lat = np.degrees(np.arctan(np.sinh(math.pi * (1 - 2 * py / n))))
                I = (M["lat0"] - lat[:, None]) / M["deg"] - 0.5 + 0 * px[None, :]
                J = (px[None, :] - M["lon0"]) / M["deg"] - 0.5 + 0 * lat[:, None]
                lr = map_coordinates(logr, [I, J], order=1, mode="nearest")
                rgba = colour(lr)
                # fade to nothing over the last 1.6 degrees of the radiance mosaic: lights beyond its edge are not in the model
                LON, LAT = np.meshgrid(px, lat)
                edge = np.minimum.reduce([LON - (-110.25), -87.75 - LON, LAT - 20.25, 40.5 - LAT])
                rgba[..., 3] = (rgba[..., 3] * np.clip(edge / 1.6, 0, 1)).astype(np.uint8)
                if rgba[..., 3].max() == 0: continue
                im = Image.fromarray(rgba, "RGBA").quantize(colors=96, method=Image.Quantize.FASTOCTREE)
                p = os.path.join(REPO, "tiles", "sky", str(z), str(x)); os.makedirs(p, exist_ok=True)
                f = os.path.join(p, f"{y}.png"); im.save(f, optimize=True)
                n_written += 1; total += os.path.getsize(f)
    print("tiles", n_written, "bytes", total)

# ---------- places ----------
def places():
    raw = json.load(open(os.path.join(REPO, "data", "research", "merged_checked.json"), encoding="utf-8"))
    out = []
    for p in raw:
        lat, lon = p["lat"], p["lon"]
        if p["id"] == "tx-cooper-lake" and p.get("_tpwd_check"):          # adopt TPWD's printed point
            lat, lon = p["_tpwd_check"][0], p["_tpwd_check"][1]
        lr = sample(lat, lon); r = 10 ** lr
        # darkest sky within ~8 km (a campground can sit away from the HQ point)
        best = min(sample(lat + dy, lon + dx) for dy in (-0.06, 0, 0.06) for dx in (-0.07, 0, 0.07))
        sqm, nelm, pct, stars = sky(r)
        out.append(dict(
            id=p["id"], name=p["name"], type=p["type"], agency=p["agency"], lat=round(lat, 5), lon=round(lon, 5),
            coordPoint=p["coord_point"], coordSource=p["coord_source"], url=p["url"], county=p["county"],
            town=p["nearest_town"], camping=p["camping"], campingKinds=p["camping_kinds"] or [],
            reserve=p["reservations_url"], acres=p["acres"], nearby=p["nearby"] or [], darkSky=p["dark_sky"],
            lpPublished=p["lp_published"], blurb=p["blurb"], status=p["status_note"],
            sky=dict(ratio=round(r, 3), sqm=round(sqm, 2), nelm=round(nelm, 2), pct=round(pct, 1), stars=stars,
                     bestNearbyRatio=round(10 ** best, 3)),
            researcher=p.get("_batch")))
    # Rose's original Oklahoma picks, kept; coordinates are from her 2025 file, not re-verified this round
    ok = [("ok-beavers-bend", "Beavers Bend State Park", 34.14454, -94.72342, "https://www.travelok.com/state-parks/beavers-bend-state-park"),
          ("ok-turner-falls", "Turner Falls Park", 34.4272, -97.1429, "https://www.turnerfallspark.com/"),
          ("ok-lake-murray", "Lake Murray State Park", 34.0561, -97.1053, "https://www.travelok.com/state-parks/lake-murray-state-park")]
    for i, n, la, lo, u in ok:
        r = 10 ** sample(la, lo); sqm, nelm, pct, stars = sky(r)
        out.append(dict(id=i, name=n, type="State Park" if "State" in n else "City Park", agency="Oklahoma (from the original StarFinder list)",
                        lat=la, lon=lo, coordPoint="from the 2025 StarFinder file", coordSource="original StarFinder.html, not re-verified",
                        url=u, county=None, town=None, camping=True, campingKinds=["cabins"], reserve=None, acres=None, nearby=[],
                        darkSky=None, lpPublished=None, blurb=None, status=None,
                        sky=dict(ratio=round(r, 3), sqm=round(sqm, 2), nelm=round(nelm, 2), pct=round(pct, 1), stars=stars, bestNearbyRatio=None),
                        researcher=None))
    meta = dict(model="StarFinder skyglow v1", built="2026-10-30", radiance="NASA Black Marble VNP46A2 gap-filled BRDF-corrected DNB radiance via NASA GIBS, median of 12 nights, Aug 10 to Oct 28 2026",
                kernel="(d^2 + 3^2)^-1.25 exp(-d/100 km), to 350 km", natural_sqm=NAT_SQM, scale=C,
                anchors="Enchanted Rock SNA and South Llano River SP, both published Bortle 3 (TPWD; DarkSky International 2017), set to an artificial-to-natural ratio of 0.2")
    json.dump(dict(meta=meta, places=out), open(os.path.join(REPO, "data", "places.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    s = sorted(out, key=lambda q: -q["sky"]["pct"])
    print("places", len(out)); print("darkest", [(q["name"], q["sky"]["sqm"], q["sky"]["stars"]) for q in s[:6]])
    print("brightest", [(q["name"], q["sky"]["sqm"], q["sky"]["stars"]) for q in s[-5:]])
    import collections; print(collections.Counter(q["sky"]["stars"] for q in out))

if __name__ == "__main__":
    import sys
    if "tiles" in sys.argv: tiles()
    else: places(); tiles()

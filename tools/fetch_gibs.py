# Fetch NASA GIBS tiles of VIIRS Black Marble gap-filled, BRDF-corrected DNB radiance (VNP46A2-derived)
# for Texas plus a ~4 degree buffer, at the native 500 m level, for several dates. Public, no login.
import os, sys, urllib.request, concurrent.futures as cf, time
OUT = r"D:\StarFinderData\gibs_dnb_gapfilled"
LAYER = "VIIRS_SNPP_GapFilled_BRDF_Corrected_DayNightBand_Radiance"
DATES = ["2026-08-10","2026-08-20","2026-08-30","2026-09-05","2026-09-12","2026-09-19",
         "2026-09-26","2026-10-03","2026-10-10","2026-10-17","2026-10-24","2026-10-28"]
LEVEL = 7            # 2.25 degree tiles of 512 px (0.004395 deg per px)
COLS = range(31, 41) # lon -110.25 .. -87.75
ROWS = range(22, 31) # lat 40.5 .. 20.25
UA = {"User-Agent": "StarFinder-data/1.0 (free public stargazing map; github rose-bot47/StarFinder)"}
def one(job):
    d, r, c = job
    p = os.path.join(OUT, d, f"{r}_{c}.png")
    if os.path.exists(p) and os.path.getsize(p) > 0: return p, "cached", os.path.getsize(p)
    u = f"https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/{LAYER}/default/{d}/500m/{LEVEL}/{r}/{c}.png"
    for attempt in range(4):
        try:
            b = urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=60).read()
            if b[:8] != b"\x89PNG\r\n\x1a\n": return p, "not png", len(b)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            open(p, "wb").write(b); return p, "ok", len(b)
        except Exception as e:
            err = str(e); time.sleep(2 + attempt * 3)
    return p, "ERR " + err[:80], 0
jobs = [(d, r, c) for d in DATES for r in ROWS for c in COLS]
tot = 0; bad = []
with cf.ThreadPoolExecutor(6) as ex:
    for p, st, n in ex.map(one, jobs):
        tot += n
        if st not in ("ok", "cached"): bad.append((p, st))
print("tiles", len(jobs), "bytes", tot, "problems", len(bad)); print(bad[:10])

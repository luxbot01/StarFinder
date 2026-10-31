# StarFinder sky-brightness model.
# Input: NASA GIBS tiles of VIIRS Black Marble gap-filled, BRDF-corrected DNB radiance (nW/cm2/sr),
#        12 dates Aug-Oct 2026, decoded through GIBS's own published colormap (180 classes, 0.1 nW steps,
#        saturating at 38.2 nW).
# Method: per-pixel median over the dates (removes clouds, fill seams and one-off fires), then
#        artificial zenith sky brightness = sum over every lit pixel of radiance x area x K(distance),
#        K(d) = (d^2 + d0^2)^-1.25 * exp(-d / L)  (Walker's d^-2.5 law with a near-field core and an
#        extinction tail), out to 350 km, by FFT. Scale fixed by published anchors (see calibrate()).
import os, re, sys, json, glob, math
import numpy as np
from PIL import Image
from scipy.signal import fftconvolve

SRC = r"D:\StarFinderData\gibs_dnb_gapfilled"
OUT = r"D:\StarFinderData\model"
os.makedirs(OUT, exist_ok=True)
ROWS = range(22, 31); COLS = range(31, 41); TS = 512; DEG = 2.25 / TS
LAT0 = 90 - 22 * 2.25; LON0 = -180 + 31 * 2.25          # top-left corner of the mosaic

def decode_table():
    s = open(sys.argv[1] if len(sys.argv) > 1 else "web/cmap.xml", encoding="utf-8").read()
    lut = np.full(256, np.nan, np.float32)
    for rgb, val in re.findall(r'rgb="(\d+),\d+,\d+" transparent="false" sourceValue="\[([^)\]]*)', s):
        lo, hi = [float(x) for x in val.split(",")]
        lut[int(rgb)] = lo if hi > 1000 else (lo + hi) / 2      # saturated class keeps its floor, 38.2
    return lut

def mosaic(date):
    H, W = len(ROWS) * TS, len(COLS) * TS
    g = np.zeros((H, W), np.uint8)
    for i, r in enumerate(ROWS):
        for j, c in enumerate(COLS):
            im = Image.open(os.path.join(SRC, date, f"{r}_{c}.png")).convert("RGB")
            g[i*TS:(i+1)*TS, j*TS:(j+1)*TS] = np.asarray(im)[..., 0]
    return g

def main():
    lut = decode_table()
    dates = sorted(os.listdir(SRC))
    stack = np.stack([mosaic(d) for d in dates])            # grey levels are monotonic in radiance
    med = np.median(stack, axis=0).astype(np.uint8)         # so the median grey is the median radiance
    del stack
    R = lut[med]; R[np.isnan(R)] = 0
    # the lowest classes are sensor noise and airglow: subtract a 0.3 nW floor before propagating
    R = np.clip(R - 0.3, 0, None)
    H, W = R.shape
    lats = LAT0 - (np.arange(H) + 0.5) * DEG
    coslat = np.cos(np.radians(lats))[:, None]
    A = R * coslat                                          # radiance x relative pixel area
    np.save(os.path.join(OUT, "radiance_median.npy"), R.astype(np.float32))
    dy = DEG * 111.32; dx = DEG * 111.32 * math.cos(math.radians(30.5))
    rad_km = 350.0; ny = int(rad_km / dy); nx = int(rad_km / dx)
    yy = (np.arange(-ny, ny + 1) * dy)[:, None]; xx = (np.arange(-nx, nx + 1) * dx)[None, :]
    d2 = yy**2 + xx**2
    d0 = float(os.environ.get("SF_D0","1")); L = float(os.environ.get("SF_L","100"))
    K = (d2 + d0**2) ** -1.25 * np.exp(-np.sqrt(d2) / L)
    K[d2 > rad_km**2] = 0
    G = fftconvolve(A.astype(np.float32), K.astype(np.float32), mode="same")
    G = np.clip(G, 0, None).astype(np.float32)
    np.save(os.path.join(OUT, os.environ.get("SF_OUTNAME","glow_raw.npy")), G)
    meta = dict(lat0=LAT0, lon0=LON0, deg=DEG, H=H, W=W, dates=dates, d0_km=d0, L_km=L, radius_km=rad_km,
                noise_floor_nW=0.3, saturation_nW=38.2)
    json.dump(meta, open(os.path.join(OUT, "meta.json"), "w"), indent=1)
    print("mosaic", H, W, "dates", len(dates), "R max", float(R.max()), "lit px >1nW", int((R > 1).sum()))

if __name__ == "__main__":
    main()

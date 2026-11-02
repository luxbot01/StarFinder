"""Keep a resized WebP copy of every place photo in the repo, so the photo arrows answer at once.

For each photo in data/places.json: fetch one copy (Wikimedia Commons through Special:FilePath at 1280 px wide,
anything else from its "img" link), then write photos/<place id>/<n>-960.webp and <n>-480.webp and record
"src", "w" and "h" on the photo. The credit, licence and page links stay as they are: the copies are the same
works, resized, under the same licences (CC BY-SA copies stay CC BY-SA).
Polite by design: one request at a time, a pause between them, an identifying User-Agent, backoff on 429/5xx.
Usage: python tools/photos_cache.py [--force]   (only photos without both files are fetched)
"""
import io, json, os, sys, time, urllib.parse, urllib.request
from PIL import Image, ImageOps

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(REPO, "data", "places.json")
UA = "StarFinder/1.0 (https://luxbot01.github.io/StarFinder/; photo cache for a free dark-sky map)"
SIZES = (960, 480)

def source_url(ph):
    page = ph.get("page", "")
    if "commons.wikimedia.org/wiki/File:" in page:
        name = urllib.parse.unquote(page.split("File:", 1)[1])
        return "https://commons.wikimedia.org/wiki/Special:FilePath/" + urllib.parse.quote(name) + "?width=1280"
    return ph["img"]

def fetch(url):
    for wait in (0, 5, 15, 45):
        if wait: time.sleep(wait)
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504): raise
    raise RuntimeError("gave up after retries: " + url)

def main(force=False):
    data = json.load(open(DATA, encoding="utf-8"))
    done = skipped = failed = 0; total = 0
    for p in data["places"]:
        for i, ph in enumerate(p.get("photos") or []):
            base = f"photos/{p['id']}/{i}"
            files = [os.path.join(REPO, f"{base}-{w}.webp") for w in SIZES]
            if not force and all(os.path.exists(f) for f in files) and ph.get("src") == base:
                skipped += 1; continue
            try:
                raw = fetch(source_url(ph)); time.sleep(1.0)
                im = ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert("RGB")
                os.makedirs(os.path.dirname(files[0]), exist_ok=True)
                for w, f in zip(SIZES, files):
                    c = im if im.width <= w else im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
                    c.save(f, "WEBP", quality=74, method=6); total += os.path.getsize(f)
                    if w == SIZES[0]: ph["w"], ph["h"] = c.width, c.height
                ph["src"] = base; done += 1
            except Exception as e:
                failed += 1; print("FAILED", p["id"], i, str(e)[:120], flush=True)
    json.dump(data, open(DATA, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"cached {done}, already there {skipped}, failed {failed}, new bytes {total}")

if __name__ == "__main__":
    main(force="--force" in sys.argv)

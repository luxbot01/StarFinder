# Batch 10's researcher hung before writing amen_10.json. This rebuilds it: the photos from their verified
# list in the transcript (licence and load already checked by them), the amenities by reading each official
# campsite page for explicit words. A field stays null unless the page says it.
import json, re, urllib.request, html
REPO = r"C:\Users\luxbo\Documents\Code\StarFinder"
TX = r"C:\Users\luxbo\AppData\Local\Temp\claude\C--Users-luxbo\cbfac5a0-8cfb-43b2-ad6f-f55a69dd39d4\tasks\ac08348bfdf484aaf.output"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130"}
lines = open(TX, encoding="utf-8", errors="replace").read().splitlines()
blob = json.loads(lines[371])["message"]["content"][0]["content"]
blob = blob if isinstance(blob, str) else json.dumps(blob)
photos = []
for m in re.finditer(r"(?m)^(\S.*?\.(?:jpg|JPG|jpeg|png))\n\s+img: (\S+)\n\s+page: (\S+)\n\s+lic: ([^|\n]+)\|\s*credit: ([^\n]+)", blob):
    photos.append(dict(file=m.group(1), img=m.group(2).split("?utm_")[0], page=m.group(3), license=m.group(4).strip(), credit=m.group(5).strip(), source="Wikimedia Commons"))
assign = json.load(open(REPO + r"\data\research\assign_10.json", encoding="utf-8"))
keys = {"tx-blanco": ["Blanco State Park"], "tx-daingerfield": ["Daingerfield"], "tx-fort-richardson": ["Fort Richardson"],
        "tx-inks-lake": ["Inks"], "tx-lake-whitney": ["Lake Whitney"], "tx-mustang-island": ["Mustang Island"],
        "tx-san-angelo": ["San Angelo State Park", "Fisher Lake"], "usfs-davy-crockett-national-forest": ["Davy Crockett"], "nps-blsc": ["Blackwell"]}
def text(url):
    try:
        h = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read().decode("utf-8", "replace")
        h = re.sub(r"<script.*?</script>|<style.*?</style>", " ", h, flags=re.S)
        return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", h))).lower()
    except Exception:
        return ""
rows = []
for a in assign:
    pid = a["id"]; slug = pid[3:]; t = ""; src = None
    if pid.startswith("tx-"):
        for u in (f"https://tpwd.texas.gov/state-parks/{slug}/fees-facilities/campsites", f"https://tpwd.texas.gov/state-parks/{slug}/fees-facilities", f"https://tpwd.texas.gov/state-parks/{slug}"):
            t = text(u)
            if "campsite" in t or "cabin" in t: src = u; break
    def says(*pats): return True if any(re.search(p, t) for p in pats) else None
    r = {"id": pid,
         "rv_30a": says(r"30[- ]?amp"), "rv_50a": says(r"50[- ]?amp"),
         "water_at_site": says(r"campsites? with water", r"water and electric", r"water, electric", r"water and 30", r"water and 50", r"full hookup"),
         "water_access": says(r"drinking water", r"potable water", r"water fountain", r"water nearby", r"water spigot"),
         "restrooms": says(r"restroom", r"\btoilet"), "showers": says(r"shower"), "cabins": says(r"\bcabins?\b", r"cottage", r"\blodge\b", r"yurt"),
         "amenity_source": src,
         "photos": [{k: p[k] for k in ("img", "page", "credit", "license", "source")} for p in photos if any(k in p["file"] for k in keys.get(pid, []))][:3],
         "notes": "Rebuilt by the orchestrator (GEGENSCHEIN) after the batch-10 researcher hung: photos are theirs (licence read and load checked by them); amenities are true only where the official page's own words say so, otherwise null." }
    if pid == "nps-blsc": r.update({"rv_30a": False, "rv_50a": False, "water_at_site": False, "cabins": False, "showers": None, "notes": r["notes"] + " Blackwell School NHS is a historic school building in Marfa with no campground."})
    rows.append(r)
json.dump({"_author": "Alidade (photos) and GEGENSCHEIN (rebuild)", "_finished": "Friday, October 30, 2026, evening", "places": rows},
          open(REPO + r"\data\research\amen_10.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print("photos parsed", len(photos))
for r in rows: print(r["id"], len(r["photos"]), {k: r[k] for k in ("rv_30a", "rv_50a", "water_at_site", "restrooms", "showers", "cabins")}, (r["amenity_source"] or "")[-40:])

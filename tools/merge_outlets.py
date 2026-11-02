"""Mark the places whose own campsite page says sites have a standard 120 V household outlet (a 20-amp NEMA 5-20 receptacle,
which takes a household 5-15 plug, or a page that says 120 V) as amen.rv120 = true, with amen.rv120src = {url, read, quote}.
Never inferred from 30-amp or 50-amp service. Reads data/research/outlets_120v_2026-11-02.json; backs places.json up first;
idempotent. Usage: python -I tools/merge_outlets.py data/research/outlets_120v_2026-11-02.json [--check]"""
import json, os, shutil, sys, time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(REPO, "data", "places.json")
BACKUPS = os.path.join(os.path.dirname(REPO), "StarFinder_backups")

rec = json.load(open(sys.argv[1], encoding="utf-8"))
data = json.load(open(DATA, encoding="utf-8"))
by = {p["id"]: p for p in data["places"]}
missing = [e["id"] for e in rec["places"] if e["id"] not in by]
if missing:
    sys.exit("record names places that are not in places.json: " + ", ".join(missing))
changed = []
for e in rec["places"]:
    a = by[e["id"]].setdefault("amen", {})
    src = {"url": e["source"], "read": e["read"], "quote": e["quote"]}
    if a.get("rv120") is not True or a.get("rv120src") != src:
        a["rv120"] = True; a["rv120src"] = src; changed.append(e["id"])
print(f"{len(changed)} place(s) gain the 120 V outlet: {', '.join(changed) or 'none'}")
if changed and "--check" not in sys.argv:
    os.makedirs(BACKUPS, exist_ok=True)
    bak = os.path.join(BACKUPS, "places_pre-outlets_%s.json" % time.strftime("%Y%m%dT%H%M%S"))
    shutil.copy2(DATA, bak)
    with open(DATA, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print("backed up to", os.path.relpath(bak, os.path.dirname(REPO)), "and wrote places.json")

"""Apply a camping audit to data/places.json: every place whose own official page says it has no camping (or is day use only)
is marked "listed": false, with "delistReason" (the page's own words) and "delistSource" (the page and when it was read).
Nothing is deleted: the row stays, the map and the list leave it out, and setting "listed" back to true (or removing the three
fields) brings it back. Places the audit calls unclear stay listed.

Usage:  python -I tools/camping_delist.py data/research/camping_audit_2026-11-02.json          (writes, after a backup)
        python -I tools/camping_delist.py data/research/camping_audit_2026-11-02.json --check  (says what it would change)
Idempotent: a second run changes nothing. Re-run it after anything that rebuilds places.json (tools/build_data.py does).
Writes with separators (",", ":") and ensure_ascii=False, like the original.
"""
import json, os, shutil, sys, time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(REPO, "data", "places.json")
BACKUPS = os.path.join(os.path.dirname(REPO), "StarFinder_backups")


def apply(places, audit):
    by = {e["id"]: e for e in audit["places"]}
    changed = []
    for p in places:
        e = by.get(p["id"])
        if not e or e["verdict"] != "no":
            continue
        want = {"listed": False, "delistReason": e["quote"],
                "delistSource": {"url": e["source"], "read": e["read"], **({"pageDate": e["pageDate"]} if e.get("pageDate") else {})}}
        if any(p.get(k) != v for k, v in want.items()):
            p.update(want); changed.append(p["id"])
    return changed


def main():
    audit = json.load(open(sys.argv[1], encoding="utf-8"))
    data = json.load(open(DATA, encoding="utf-8"))
    missing = [e["id"] for e in audit["places"] if e["verdict"] == "no" and e["id"] not in {p["id"] for p in data["places"]}]
    if missing:
        sys.exit("audit names places that are not in places.json: " + ", ".join(missing))
    changed = apply(data["places"], audit)
    listed = sum(1 for p in data["places"] if p.get("listed") is not False)
    print(f"{len(changed)} place(s) to delist: {', '.join(changed) or 'none'}; {listed} of {len(data['places'])} listed after")
    if "--check" in sys.argv or not changed:
        return
    os.makedirs(BACKUPS, exist_ok=True)
    bak = os.path.join(BACKUPS, "places_pre-delist_%s.json" % time.strftime("%Y%m%dT%H%M%S"))
    shutil.copy2(DATA, bak)
    with open(DATA, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print("backed up to", os.path.relpath(bak, os.path.dirname(REPO)), "and wrote places.json")


if __name__ == "__main__":
    main()

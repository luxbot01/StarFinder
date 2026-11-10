#!/usr/bin/env python3
"""Tests for tools/burnbans.py, run before every scheduled fetch:  python -I tools/test_burnbans.py
Each test plants a county it knows the answer for. The control at the end breaks the code on purpose and expects the
planted-positive test to turn red, so a test that cannot fail does not pass quietly."""
import json, sys, traceback
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import burnbans as bb  # noqa: E402

TX = json.loads((HERE.parent / "data" / "tx_counties.json").read_text(encoding="utf-8"))
NOW = datetime(2026, 11, 2, 12, 0, 0, tzinfo=timezone.utc)
STAMP = "10/30/2026 8:18:37 AM"


def mk(names, stamp=STAMP, count=None, xml_names=None, xml_stamp=None, doctype=False):
    n = len(names) if count is None else count
    txt = ("﻿%d Texas Burn Bans - %s\r\n" % (n, stamp) + "".join(x + "\r\n" for x in names)).encode("utf-16-le")
    assert txt[:2] == b"\xff\xfe"   # the leading U+FEFF encodes to the BOM, like the real file
    xn = names if xml_names is None else xml_names
    body = "<?xml version='1.0' encoding='utf-16'?> <rss version='2.0'><channel><title>Texas Burn Bans</title><item><title>\r\n%d Texas Burn Bans - %s</title><description>\r\n%s\r\n</description></item></channel></rss>" % (
        len(xn), xml_stamp or stamp, ", ".join(xn))
    if doctype:
        body = "<!DOCTYPE x [<!ENTITY a 'b'>]>" + body
    return txt, b"\xff\xfe" + body.encode("utf-16-le")


def P(pid, county):
    return {"id": pid, "county": county}


PLACES = [P("tx-colorado-bend", "San Saba"), P("tx-inks-lake", "Burnet"), P("tx-dewitt", "DeWitt"), P("ok-turner-falls", None),
          P("nps-lamr", "Hutchinson (the NRA also spans Moore and Potter, per Wikipedia)"), P("tx-purtis-creek", "Henderson and Van Zandt"),
          P("tx-eagle", "El Paso"), P("tx-lasalle", "La Salle")]
OVR = dict(bb.OVERRIDES)


def run(names, **kw):
    t, x = mk(names, **{k: v for k, v in kw.items() if k in ("stamp", "count", "xml_names", "xml_stamp", "doctype")})
    return bb.build(t, x, PLACES, TX, kw.get("prev"), NOW, accept_drop=kw.get("accept_drop", False))


def expect_fail(fn, label):
    try:
        fn()
    except bb.Fail:
        return
    raise AssertionError("expected Fail: " + label)


def t_planted_positive():
    r = run(["SAN SABA", "BURNET"])["places"]
    assert r["tx-colorado-bend"]["status"] == "ban" and r["tx-colorado-bend"]["banned"] == ["San Saba"], r["tx-colorado-bend"]
    r = run(["LAMPASAS"])["places"]   # the second county of Colorado Bend alone is enough
    assert r["tx-colorado-bend"]["status"] == "ban" and r["tx-colorado-bend"]["banned"] == ["Lampasas"], r["tx-colorado-bend"]


def t_clean_negative():
    r = run(["BURNET", "TRAVIS"])["places"]
    assert r["tx-colorado-bend"]["status"] == "none" and r["tx-colorado-bend"]["banned"] == []
    assert r["tx-colorado-bend"]["counties"] == ["San Saba", "Lampasas"]
    assert r["tx-inks-lake"]["status"] == "ban"
    r = run([])["places"]               # a list with no counties at all is a valid "none anywhere" list
    assert all(v["status"] in ("none", "not_covered") for v in r.values())


def t_names_and_multicounty():
    r = run(["DEWITT", "EL PASO", "LA SALLE", "VAN ZANDT", "POTTER"])["places"]
    assert r["tx-dewitt"]["status"] == "ban"                      # DEWITT vs DeWitt
    assert r["tx-eagle"]["status"] == "ban" and r["tx-lasalle"]["status"] == "ban"
    assert r["tx-purtis-creek"]["banned"] == ["Van Zandt"] and r["tx-purtis-creek"]["counties"] == ["Henderson", "Van Zandt"]
    assert r["nps-lamr"]["counties"] == ["Hutchinson", "Moore", "Potter"] and r["nps-lamr"]["banned"] == ["Potter"]
    assert r["ok-turner-falls"] == {"counties": [], "status": "not_covered", "banned": []}


def t_refusals():
    expect_fail(lambda: run(["SAN SABA", "BURNET"], count=5), "count mismatch (a truncated file)")
    expect_fail(lambda: run(["SAN SABA"], xml_names=["SAN SABA", "BURNET"]), "txt and xml disagree on the names")
    expect_fail(lambda: run(["SAN SABA"], xml_stamp="10/31/2026 8:18:37 AM"), "txt and xml disagree on the date")
    expect_fail(lambda: run(["SAN SABA", "ATLANTIS"]), "not a county")
    expect_fail(lambda: run(["SAN SABA", "SAN SABA"]), "listed twice")
    expect_fail(lambda: run(["SAN SABA"], doctype=True), "DOCTYPE")
    t, x = mk(["SAN SABA"])
    expect_fail(lambda: bb.build(b"\xff\xfe" + "<html>moved</html>".encode("utf-16-le"), x, PLACES, TX, None, NOW), "garbage header")
    expect_fail(lambda: bb.build(b"", x, PLACES, TX, None, NOW), "empty file")
    expect_fail(lambda: bb.build(t, x, PLACES + [P("tx-nowhere", "Narnia")], TX, None, NOW), "a place county that is not a Texas county")


def t_big_drop():
    prev = {"banCount": 149}
    expect_fail(lambda: run(["SAN SABA"] * 1 + ["BURNET", "TRAVIS"], prev=prev), "149 to 3 counties overnight")
    run(["SAN SABA", "BURNET", "TRAVIS"], prev=prev, accept_drop=True)       # taken by hand
    run(["SAN SABA", "BURNET", "TRAVIS"], prev={"banCount": 4})              # a small list moves freely


def t_stamp():
    assert bb.stamp_to_iso("10/30/2026 8:18:37 AM") == "2026-10-30T08:18:37-05:00"
    assert bb.stamp_to_iso("11/2/2026 2:05:00 PM") == "2026-11-02T14:05:00-06:00"
    assert bb.stamp_to_iso("1/15/2027 12:00:00 AM") == "2027-01-15T00:00:00-06:00"
    assert bb.stamp_to_iso("3/8/2026 1:30:00 AM") == "2026-03-08T01:30:00-06:00"   # before the second Sunday of March 2026 turns clocks
    assert bb.stamp_to_iso("3/8/2026 3:00:00 AM") == "2026-03-08T03:00:00-05:00"


def t_heartbeat_logic():
    a = run(["SAN SABA"])
    b = dict(a, checked="2026-11-02T18:00:00Z")
    assert bb.same_but_checked(a, b) and not bb.same_but_checked(a, run(["SAN SABA", "BURNET"])) and not bb.same_but_checked(None, a)
    assert bb.age_hours("2026-11-02T00:00:00Z", NOW) == 12.0


# ---- the parks' own alert pages (added Nov 10 2026, after the audit in StarfinderContext V10 found five park bans we missed) ----
def alert_page(*alerts):
    """A page in the shape TPWD serves (read Nov 10 2026): one <h3> per alert inside notice-message, then its paragraph."""
    items = "".join("<h3>%s</h3>&#13;\n<p>%s</p>&#13;\n" % a for a in alerts)
    return ('<html><main id="content"><h1 class="documentFirstHeading">Park Alerts</h1><div id="content-core">\n<div class="alert">'
            '<div class="notice-blurb"><h2><span>Park Alert...</span></h2></div><div class="notice-message">%s<hr />&#13;\n'
            '<p>Check back for updates.</p></div></div>\n</div><div id="viewlet-below-content-body"></div></main></html>' % items).encode("utf-8")


NOALERTS = (302, b"", "https://tpwd.texas.gov/acl_users/credentials_cookie_auth/require_login?came_from=https%3A//tpwd.texas.gov/state-parks/x/alert")
BAN = (200, alert_page(("Burn Ban", "Oct. 19, 2026 - The park is under a burn ban. No wood fires allowed. You may use charcoal for cooking only."),
                       ("Low Lake Level", "June 22, 2026 - The lake is lower than normal.")), "")
OTHER = (200, alert_page(("Park Closures", "Some campsites will be closed on Dec. 3."),), "")
PARKS = [{"id": "tx-inks-lake", "county": "Burnet", "url": "https://tpwd.texas.gov/state-parks/inks-lake"},
         {"id": "tx-colorado-bend", "county": "San Saba", "url": "https://tpwd.texas.gov/state-parks/colorado-bend"},
         {"id": "tx-dewitt", "county": "DeWitt", "url": "https://tpwd.texas.gov/state-parks/dewitt"},
         {"id": "nps-lamr", "county": "Hutchinson", "url": "https://www.nps.gov/lamr/"}]
NOTICE = "https://tpwd.texas.gov/state-parks/park-information/notices/screwworm-alert"


def home(slug, alert_path=None, notice=False):
    """A park home page in the shape TPWD serves: the banner and its View links when the park has alerts."""
    links = ([alert_path] if alert_path else []) + ([NOTICE] if notice else [])
    banner = "".join('<div class="shortmessage" id="park-alert%d"><p>This park has active alerts</p><p><a class="js-more-link" id="more-info%d" '
                     'href="%s">View</a></p></div>' % (i, i, u) for i, u in enumerate(links, 1))
    return (200, ('<html><body>%s<div class="park-row"><main><h1>%s</h1></main></div></body></html>' % (banner, slug)).encode("utf-8"), "")


def stub(answers):
    """answers: {slug: (home_answer, alert_answer_or_None)}; the alert answer is served at whatever path the home page links."""
    def get(url):
        if url == NOTICE:
            return answers.get("_notice", OTHER)
        rest = url.split("/state-parks/")[1].strip("/").split("/")
        a = answers[rest[0]]
        a = a[0] if len(rest) == 1 else a[1]
        if isinstance(a, Exception):
            raise a
        return a
    return get


def H(slug, alert, path="alert", notice=False):
    """The home page plus its alert page, as the stub serves them (alert None: a park with no alerts)."""
    if isinstance(alert, Exception) and alert.args == ("home",):
        return (alert, None)
    return (home(slug, None if alert is None else "https://tpwd.texas.gov/state-parks/%s/%s" % (slug, path), notice), alert)


def run_parks(names, answers, prev=None, accept_drop=False):
    t, x = mk(names)
    parks = bb.read_parks(PARKS, stub(answers))
    return bb.build(t, x, PARKS, TX, prev, NOW, accept_drop=accept_drop, parks=parks)


def t_park_ban_without_county():
    """The audit's case: the park posts a burn ban and no county of it is on the state list. The place is under a ban."""
    out = run_parks(["TRAVIS"], {"inks-lake": H("inks-lake", BAN), "colorado-bend": H("colorado-bend", None), "dewitt": H("dewitt", OTHER)})
    r = out["places"]["tx-inks-lake"]
    assert r["status"] == "ban" and r["countyStatus"] == "none" and r["banned"] == [], r
    assert r["park"]["status"] == "ban" and r["park"]["posted"] == "Oct. 19, 2026", r["park"]
    assert r["park"]["text"].startswith("The park is under a burn ban. No wood fires allowed."), r["park"]
    assert r["park"]["url"] == "https://tpwd.texas.gov/state-parks/inks-lake/alert"
    assert out["places"]["tx-colorado-bend"]["status"] == "none" and out["places"]["tx-colorado-bend"]["park"]["status"] == "none"
    assert out["places"]["tx-dewitt"]["park"]["status"] == "none" and out["places"]["tx-dewitt"]["park"]["alerts"] == 1   # alerts, none about fire
    assert "park" not in out["places"]["nps-lamr"] and out["parkBanCount"] == 1           # federal land has no park page here


def t_park_alert_shapes():
    """TPWD posts at /alert for most parks and /park-alert for some (Sheldon Lake, Palo Pinto Mountains); a park may also link only a
    statewide notice (Longhorn Cavern). The link on the home page is followed, never a built URL."""
    out = run_parks(["TRAVIS"], {"inks-lake": H("inks-lake", OTHER), "colorado-bend": H("colorado-bend", BAN, path="park-alert"),
                                 "dewitt": (home("dewitt", None, notice=True), None)})["places"]
    assert out["tx-colorado-bend"]["status"] == "ban" and out["tx-colorado-bend"]["park"]["url"].endswith("/colorado-bend/park-alert")
    assert out["tx-dewitt"]["park"]["status"] == "none" and out["tx-dewitt"]["park"]["alerts"] == 1   # the notice was read, and is not a ban
    assert out["tx-inks-lake"]["park"]["status"] == "none"


def t_park_unknown_is_never_none():
    # one unreadable park among a dozen (under the guard's tenth): that park is "unknown", never "none"
    many = PARKS + [{"id": "tx-p%d" % i, "county": "Travis", "url": "https://tpwd.texas.gov/state-parks/p%d" % i} for i in range(9)]
    calm = {"colorado-bend": H("colorado-bend", None), "dewitt": H("dewitt", OTHER)} | {"p%d" % i: H("p%d" % i, None) for i in range(9)}

    def go(names, inks):
        t, x = mk(names)
        return bb.build(t, x, many, TX, None, NOW, parks=bb.read_parks(many, stub(calm | {"inks-lake": inks})))["places"]["tx-inks-lake"]
    r = go(["TRAVIS"], ((200, b"<html><p>a redesigned page</p></html>", ""), None))      # the home page lost its known shape
    assert r["status"] == "unknown" and r["park"]["status"] == "unknown", r
    assert go(["TRAVIS"], (OSError("timed out"), None))["status"] == "unknown"           # the home page did not answer
    assert go(["TRAVIS"], H("inks-lake", (404, b"", "")))["status"] == "unknown"           # a View link that leads nowhere
    assert go(["TRAVIS"], H("inks-lake", (200, b"<html>no notices here</html>", "")))["status"] == "unknown"   # an alert page of a new shape
    assert go(["BURNET"], (OSError("timed out"), None))["status"] == "ban"                # the county ban still stands
    big = PARKS[:3]
    try:
        bb.read_parks(big, stub({"inks-lake": (OSError("x"), None), "colorado-bend": (OSError("y"), None), "dewitt": H("dewitt", OTHER)}))
    except bb.Fail:
        pass
    else:
        raise AssertionError("two of three park pages unreadable must fail the run")
    expect_fail(lambda: bb.parse_park_alert(302, b"", "https://tpwd.texas.gov/somewhere-else"), "an unexpected redirect")
    expect_fail(lambda: bb.parse_park_alert(500, b"", ""), "a server error")


def t_park_drop_guard():
    quiet = {"inks-lake": H("inks-lake", None), "colorado-bend": H("colorado-bend", None), "dewitt": H("dewitt", OTHER)}
    expect_fail(lambda: run_parks(["TRAVIS"], quiet, prev={"banCount": 3, "parkBanCount": 9}), "every park ban vanishing at once")
    run_parks(["TRAVIS"], quiet, prev={"banCount": 3, "parkBanCount": 9}, accept_drop=True)


def t_multicounty_overrides():
    """The audit's second case: a place reaching several counties is checked against every one of them."""
    pl = [{"id": "usfs-sabine-national-forest", "county": "Sabine"}, {"id": "nps-pais", "county": "Nueces"},
          {"id": "usfs-davy-crockett-national-forest", "county": "Houston"}, {"id": "nps-bith", "county": "Hardin"}]
    t, x = mk(["SHELBY", "WILLACY", "TRINITY", "TYLER"])
    r = bb.build(t, x, pl, TX, None, NOW)["places"]
    assert r["usfs-sabine-national-forest"]["banned"] == ["Shelby"] and r["usfs-sabine-national-forest"]["status"] == "ban"
    assert r["nps-pais"]["counties"] == ["Kleberg", "Kenedy", "Willacy"] and r["nps-pais"]["status"] == "ban"
    assert r["usfs-davy-crockett-national-forest"]["banned"] == ["Trinity"] and r["nps-bith"]["banned"] == ["Tyler"]
    t, x = mk(["NUECES"])
    assert bb.build(t, x, pl, TX, None, NOW)["places"]["nps-pais"]["status"] == "none"   # the city end of the island is not the seashore


def t_carry_last_park_ban():
    """A park that showed a ban last run and cannot be read now keeps the ban, marked as carried, never cleared silently."""
    many = PARKS + [{"id": "tx-p%d" % i, "county": "Travis", "url": "https://tpwd.texas.gov/state-parks/p%d" % i} for i in range(9)]
    calm = {"colorado-bend": H("colorado-bend", None), "dewitt": H("dewitt", OTHER)} | {"p%d" % i: H("p%d" % i, None) for i in range(9)}
    t, x = mk(["TRAVIS"])
    first = bb.build(t, x, many, TX, None, NOW, parks=bb.read_parks(many, stub(calm | {"inks-lake": H("inks-lake", BAN)})))
    second = bb.build(t, x, many, TX, first, NOW, parks=bb.read_parks(many, stub(calm | {"inks-lake": (OSError("timed out"), None)})))
    r = second["places"]["tx-inks-lake"]
    assert r["status"] == "ban" and r["park"]["status"] == "ban" and r["park"]["carried"] is True, r
    assert r["park"]["lastRead"] == first["parksRead"] and "timed out" in r["park"]["why"], r["park"]
    third = bb.build(t, x, many, TX, None, NOW, parks=bb.read_parks(many, stub(calm | {"inks-lake": (OSError("timed out"), None)})))
    assert third["places"]["tx-inks-lake"]["status"] == "unknown"                         # nothing to carry: unknown, not none
    assert first["places"]["tx-dewitt"]["countiesFrom"] == "places.json county text"
    assert first["places"]["tx-colorado-bend"]["countiesFrom"] == "Wikipedia"


def t_heartbeat_ignores_read_time():
    a = run_parks(["TRAVIS"], {"inks-lake": H("inks-lake", BAN), "colorado-bend": H("colorado-bend", None), "dewitt": H("dewitt", OTHER)})
    assert bb.same_but_checked(a, dict(a, checked="2026-11-03T00:00:00Z", parksRead="2026-11-03T00:00:00Z"))


TESTS = [t_planted_positive, t_clean_negative, t_names_and_multicounty, t_refusals, t_big_drop, t_stamp, t_heartbeat_logic,
         t_park_ban_without_county, t_park_alert_shapes, t_park_unknown_is_never_none, t_park_drop_guard, t_multicounty_overrides,
         t_heartbeat_ignores_read_time, t_carry_last_park_ban]


def control_old_watcher():
    """The watcher as it was before Nov 10 (the parks never read): the planted park ban must turn the test red."""
    real = bb.parse_park_alert
    bb.parse_park_alert = lambda status, body, location="": {"status": "none", "heading": None, "text": None, "posted": None, "alerts": 0}
    try:
        t_park_ban_without_county()
    except AssertionError:
        return True
    finally:
        bb.parse_park_alert = real
    return False


def control_one_county():
    """Overrides gone (one county per place, as before): the multi-county test must turn red."""
    real = dict(bb.OVERRIDES)
    for k in ("usfs-sabine-national-forest", "nps-pais", "usfs-davy-crockett-national-forest", "nps-bith"):
        bb.OVERRIDES.pop(k, None)
    try:
        t_multicounty_overrides()
    except AssertionError:
        return True
    finally:
        bb.OVERRIDES.clear(); bb.OVERRIDES.update(real)
    return False


def control():
    """Break the matching on purpose: the planted-positive test must go red, or it proves nothing."""
    real = bb.key
    bb.key = lambda n: n   # an exact string compare, so DEWITT no longer meets DeWitt
    try:
        t_names_and_multicounty()
    except (AssertionError, bb.Fail):
        return True
    finally:
        bb.key = real
    return False


def main():
    bad = 0
    for t in TESTS:
        try:
            t()
            print("ok   ", t.__name__)
        except Exception:
            bad += 1
            print("FAIL ", t.__name__)
            traceback.print_exc()
    controls = [(control, "a broken matcher turns the name test red"), (control_old_watcher, "the old watcher (parks never read) turns the park-ban test red"),
                (control_one_county, "one county per place turns the multi-county test red")]
    for fn, label in controls:
        ok = fn()
        print("ok   " if ok else "FAIL ", "control: " + label)
        bad += 0 if ok else 1
    print("%d of %d passed" % (len(TESTS) + len(controls) - bad, len(TESTS) + len(controls)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

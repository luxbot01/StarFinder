# StarFinder

A free map of dark skies and campsites across Texas. Every Texas state park, state natural area and
state historic site (89), every National Park Service unit in Texas with a place to visit (15), and the
national forests and grasslands (9), plus three Oklahoma favourites from the first version: 116 places,
each rated by how much of the night sky you can expect to see there.

Open `StarFinder.html` through any static web server (for example `python -m http.server`); opening the
file directly will not load the data.

## What the stars mean

Each place gets the modelled brightness of the sky straight overhead (mag/arcsec²), the faintest star
a naked eye should see there, and the share of a pristine sky's stars that remain visible. The star
rating is that share in half stars, 20 percentage points per star. These are model estimates for a
clear, moonless night, not measurements.

## How the sky glow is made (`tools/`)

1. `fetch_gibs.py` downloads NASA GIBS tiles of the VIIRS Black Marble gap-filled, BRDF-corrected
   Day/Night Band radiance (VNP46A2) for 12 nights, Aug 10 to Oct 28 2026, at the native ~500 m, over
   110.25°W to 87.75°W and 20.25°N to 40.5°N (1,080 tiles, 91 MB, kept outside the repo).
2. `skyglow.py` decodes each grey level through GIBS's own colormap (`gibs_dnb_colormap.xml`, 180
   classes of 0.1 nW/cm²/sr, saturating at 38.2), takes the per-pixel median over the nights, removes a
   0.3 nW floor, and spreads every lit pixel's light by K(d) = (d² + 3²)^-1.25 · e^(-d/100 km) out to
   350 km (Walker's d^-2.5 law with a near-field core and an extinction tail), by FFT.
3. `probe.py` fixes the scale: Enchanted Rock SNA and South Llano River SP, both published Bortle 3,
   are set to an artificial-to-natural ratio of 0.2. Big Bend National Park then reads 22.00,
   McDonald Observatory 21.96, and downtown Austin, Dallas and Houston 18.16, 17.87 and 17.77.
4. `build_data.py` writes `data/places.json` and the overlay tiles in `tiles/sky/{z}/{x}/{y}.png`
   (zoom 4 to 9, 1,366 tiles, 5.4 MB).

Known limits: VIIRS sees little of the blue in white LEDs; bright city cores saturate at 38.2;
the Bortle scale is a whole-sky judgement by eye and this is the zenith only.

## The seven-day forecast (`app/forecast.js`)

Opening a place (its card, or its pin's pop-up) fetches that park's forecast; nothing is fetched before.
The source is the US National Weather Service API (`api.weather.gov`): `/points/{lat},{lon}` gives the
forecast grid and the park's time zone (kept a week), then the gridpoint data gives, per local day: the
day's high and that night's low, the highest chance of precipitation, the amounts of rain, snow and ice
(summed over the day, inches), the sky cover by the hour, and the forecast's own weather types, including
`hail` and the `small_hail` / `large_hail` attributes. The icon follows from those: hail only when the
forecast names hail, storm, freezing rain or sleet, rain and snow, snow, rain, or clear, partly cloudy and
cloudy from the daytime sky cover. "Clearest night" is the lowest mean cloud cover from 9 PM to 3 AM; the
moon's lit fraction comes from the mean synodic month (it reads 99.8% and 100% at the two 2026 lunar
eclipses). If NWS does not answer, Open-Meteo is asked (`api.open-meteo.com`, WMO weather codes; its US
models do not forecast hail), and its credit sits beside the data. Answers are kept in `localStorage` for
30 minutes; offline, a copy up to 12 hours old is shown and labelled, and a failed card retries by itself
when the browser comes back online. The icons are drawn in the file, by us.

## Photos (`tools/`)

Each place carries a few photos with their credit and licence. Rules: no Texas state park (TPWD) site photos; Wikimedia
Commons files only if their own metadata says CC0, CC BY, CC BY-SA or public domain (no NC, no ND); National Park Service
photos only if NPGallery's record says "Public domain" with full granting rights and no credit that says courtesy, copyright
or permission (credited "NPS Photo / name", as nps.gov does, and linked to the photo's own nps.gov asset page, which prints the
credit and the constraint).
`nps_photos.py` finds NPS candidates (the same NPGallery API nps.gov's galleries read, no key) and `commons_photos.py` finds
Commons candidates with licences read from Commons' metadata; both write a numbered contact sheet to look at. A person (or a
helper) chooses by number, `build_commons_picks.py` builds the records from the candidate files (no one types a licence), and
`merge_photos.py` refuses anything that breaks the rules above, skips duplicates and backs up `places.json`. Then
`python -I tools/photos_cache.py` keeps resized WebP copies in `photos/` so the arrows answer at once. Wrong-place traps seen:
Commons categories and searches for Cooper Lake, Bear Creek, Tyler and Village Creek also return same-named parks in other states.

## Burn bans (`tools/burnbans.py`, `.github/workflows/burnbans.yml`, `app/burnban.js`)

**Two sources since Nov 10 2026.** An audit that day (every park's own page read the same day, expected against shown) found
nine places showing "No county burn ban reported" while a ban applied: five Texas state parks post burn bans of their own that do
not wait for a county order (Bastrop, Buescher, Goose Island, Devils River, Post Oak Ridge), and four multi-county federal units
were checked against one county only (Sabine NF, Davy Crockett NF, Big Thicket, Padre Island). So the job now also reads each
state park's home page the way a visitor does and follows every "This park has active alerts > View" link (TPWD posts at
`/<park>/alert`, at `/<park>/park-alert`, or links a statewide notice, so links are read, never built): about 165 requests and
10 MB a run, one request a second, allowed by TPWD's robots.txt. A place is under a ban if its park OR any county it reaches says
so; the card names the source, quotes the park's first two sentences with the posted date and links the page. A park whose pages
cannot be read is "unknown" and never "no ban"; more than a tenth unreadable, or every park ban vanishing at once, fails the run.
`OVERRIDES` lists every county of the multi-county places with where each list was read.

**The independent check:** `python -I tools/audit_burnbans.py [file] [--saved <dir>]` re-reads every park's own pages with its
own code (no import from the watcher) and exits 1 if any park says burn ban while the file shows otherwise. Proved on Nov 10:
red against the file that was live (the five parks named), green against the new file, red again against a copy with one planted
wrong answer. The pages of that audit are in `D:\StarFinderData\burnban_audit_2026-11-10` on the build PC.

### The county list

Every 6 hours a scheduled GitHub Actions job reads the Texas A&M Forest Service's county burn-ban list, the
`BURNBAN.txt` file linked from their [burn bans page](https://tfsweb.tamu.edu/wildfire-and-other-disasters/burn-bans-and-information/)
(UTF-16, first line `149 Texas Burn Bans - 10/30/2026 8:18:37 AM`), and cross-checks it against the `BURNBAN.XML` file
beside it. It writes `data/burnbans.json` and commits it only when something changed or the last check is 11 hours old
(so `checked` is never much more than 12 hours behind); the commit is made by `github-actions[bot]` with the run's own
`GITHUB_TOKEN`, permission `contents: write` and nothing else, and no secret or personal credential exists anywhere.
A park's counties come from the `county` field in `places.json` (a few multi-county parks are listed in `OVERRIDES`
in `burnbans.py`, for example Colorado Bend: San Saba and Lampasas); a park is "in effect" if any of its counties is on the list.

It fails closed. A header that does not parse, a count that does not match the names, a name that is not one of the 254
Texas counties (`data/tx_counties.json`, from the Census Bureau's 2020 county file), the `.txt` and `.xml` disagreeing, a
list that loses more than half its counties at once, or any network error, makes the run fail and leave the last good
file alone. The card then ages it out by itself: after 48 hours without a good check, or if the state's own list is more
than 14 days old, it says the information is out of date and shows no status. An absent reading is never shown as "no ban".
After a real mass lifting, run the workflow by hand with `accept_drop` ticked; `force` writes the file even when nothing changed.

The card says "Burn ban in effect (X County)" or "No county burn ban reported; check the park's rules", with the
counties looked up, the list's date, when it was last checked and a link to the Forest Service. It says nothing about
whether a fire is allowed: the park's own rules still apply, and national parks, forests and grasslands are federal land with
their own fire orders. Oklahoma places say plainly that they are not covered.

A place under a ban also carries the burn-ban mark, a flame with a line through it (`app/burnban.js` draws it, one copy of
the shape): first in the icon strip of its list row and pin pop-up (labelled "Burn ban in effect, X County" for screen readers),
in place of the plain flame on its card, and as a badge beside its map dot from zoom 6.4, where place names appear. The legend
keys the badge. One colour, `--ban` (`oklch(0.75 0.155 45)`, `#fd8a54`), redder than the gold of the star dots so it is never
read as "good stars"; measured 6.4:1 on the chip, 7.6:1 on the card's box and 7.5:1 or more on the badge's own disc. An old or
missing reading shows the mark nowhere, the same rule as the card's words.

Terms: the Forest Service's site policy (read Nov 2 2026) invites personal, educational and other non-commercial use if
the source is cited and linked and their notices stay; it gives no guarantee of accuracy or currency. Only county names and
the list's date are used, StarFinder carries no ads, and the card credits and links them. If StarFinder ever sells anything or
carries ads, ask them first. GitHub turns scheduled workflows off after 60 days with no repository activity; if the card starts
saying the information is out of date, check that the workflow is still enabled.

Tests: `python -I tools/test_burnbans.py` (the job runs it before every fetch; a planted county must be found, a clean list
must stay clean, each refusal must refuse, and a broken matcher must turn a test red), `node tools/test_burnban_view.mjs`
(the card's words, escaping, the two staleness cut-offs, and the mark's chip, label, mask ids and badge), `node tools/shoot_burn.mjs <outDir>` (the real file and the
stale, missing and not-JSON roads, in Chromium and WebKit at four sizes; the banned state park it checks is read from today's
file), and `node tools/shoot_banicon.mjs <outDir> check` (the mark on every banned row and no other, on the pop-up and card,
map badges for banned places only, none on a stale file, in both engines at three sizes).

## Park data (`data/research/`)

Twelve researcher batches in one fixed schema (`HAIKU_BRIEF.md`), merged and checked:
`verify.py` re-read every TPWD park page's printed latitude and longitude (88 of 89 within 0.5 km;
Cooper's two units differ by 6.8 km and the TPWD point is used), and `verify2.py` compared the NPS and
Forest Service points with Wikipedia's coordinates.

## Camping: every place on the map (`data/research/camping_audit_2026-11-02.json`, `tools/camping_delist.py`)

StarFinder is a map of places you can camp. On Nov 2 2026 every place's own official page was read (the `url` in
`places.json`, plus the agency's camping page where one exists: a TPWD campsites fee page, an NPS camping or eating-and-sleeping
page, a Forest Service campground page) and each place got a verdict with the sentence it rests on, the page, that page's own date
when it prints one, and the time it was read: **yes** (any camping: campground, primitive, backcountry or dispersed), **no** (the
page says no camping, or that the place is day use only) or **unclear** (the page does not say). Result: 94 yes, 5 no, 17 unclear.

Only **no** leaves the map. `python -I tools/camping_delist.py data/research/camping_audit_2026-11-02.json` marks those places
`"listed": false` with `"delistReason"` (the page's words) and `"delistSource"` (page, read time, page date); the app skips them,
the row stays in the data. To bring one back, set `listed` to true or delete the three fields. The tool is idempotent and backs
up `places.json` first; re-run it after anything that rebuilds `places.json` (`tools/build_data.py` does). Unclear places stay
listed; their sentences are in the audit file. Tests: `python -I tools/test_camping_delist.py`.

## The filter row and the amenity icons (`app/starfinder.js` AMEN and IC)

One row, left to right: Dark Sky Places, then one toggle per amenity icon, then Camping, 4 stars and up, No county ban, who runs
it and the sort. It never wraps; it scrolls sideways (a mouse wheel scrolls it while the pointer is on it), with a fade at the
right edge until the end is reached. Pressing icons keeps the places that have ALL of them, and the count line says so ("19 of
111 places with 50A AND 120V") with a Clear button. The hash carries the filters (`#p=<id>&f=darksky.rv50.rv120`), so a shared
link opens the same view. Targets are 44 px on touch screens. The icons, their labels and their order come from one list, AMEN,
used by the list rows, the pop-up, the card and the filter row: 50A, 30A, 120V, water at sites, drinking water, restrooms,
showers, cabins. "No county ban" keeps places a current burn-ban reading says are not on the list (Oklahoma is not tracked and
drops out); with no current reading the chip is hidden.

The 120 V household outlet (`amen.rv120`, a NEMA 5-15 face; a 20-amp 5-20 receptacle takes the same plug) is marked only where
the place's own campsite page names a 20-amp or 120 V outlet, never from 30-amp or 50-amp alone: 21 places on Nov 2 2026, each
with `amen.rv120src` {url, read, quote}; record `data/research/outlets_120v_2026-11-02.json`, applied by
`python -I tools/merge_outlets.py data/research/outlets_120v_2026-11-02.json` (idempotent, backs up first). A place whose page
is silent shows nothing for 120 V, never a struck-through icon. Tests: `node tools/shoot_filters.mjs <outDir> check`.

## Sources and licences

| What | Source | Licence |
|---|---|---|
| Night-time radiance and the live lights layer | NASA GIBS, VIIRS SNPP Gap-Filled BRDF Corrected DNB Radiance | NASA data, no restrictions; credit NASA |
| Base map | OpenFreeMap dark style (OpenMapTiles schema) | Map data © OpenStreetMap contributors, ODbL |
| Map engine | MapLibre GL JS 5.24.0, vendored in `vendor/maplibre-gl/5.24.0/` with its licence file | BSD-3-Clause |
| Park facts | TPWD, NPS and USDA Forest Service pages; Wikipedia where no official point exists | facts, each linked |
| Dark Sky Places | DarkSky International | as published |
| Photos | Wikimedia Commons, linked | each file's own licence |
| Seven-day forecast | National Weather Service API, gridpoint forecast | US government open data, free for any use; credit NWS |
| County burn bans | Texas A&M Forest Service, Texas Burn Bans list (county names and its date only) | non-commercial use with the source cited and linked (their site policy); no guarantee of currency |
| Forecast when NWS does not answer | Open-Meteo.com | data CC BY 4.0, "Weather data by Open-Meteo.com" shown beside it; their free service is for non-commercial sites |

Not used, and why: the World Atlas of Artificial Night Sky Brightness (Falchi et al. 2016) is
CC BY-NC 4.0; David Lorenz's 2025 atlas publishes no licence; lightpollutionmap.info's tiles are not
openly licensed; the earlier ArcGIS overlay had no stated licence. NASA's VNP46A4 annual composite
would be better than a 12-night median, but downloading it needs a NASA Earthdata login.

## Tests

With the site served on port 4317 (`python -m http.server 4317`):
`node tools/shoot_wx.mjs <outDir>` walks 13 sizes in Chromium and 9 in WebKit (phones, fold cover and inner
screen, landscape, tablet, laptop, 1440, 1920, 21:9 and a portrait monitor) and reports console errors,
failed responses, the search capsule's sizes, the forecast's seven days and any clipped column;
`node tools/test_wx_paths.mjs <outDir>` makes each failure happen on purpose (NWS down, both down,
offline and back, the cache, an expired copy offline). `tools/shoot.mjs` and `tools/shoot_pop.mjs` are
the earlier layout passes.

Code: Apache-2.0 (see LICENSE).

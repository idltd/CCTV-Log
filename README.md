# CCTV SAR

A Progressive Web App (PWA) for UK residents to submit Subject Access Requests for CCTV footage under the UK GDPR and Data Protection Act 2018.

**Live app:** [https://idltd.github.io/CCTV-Log/](https://idltd.github.io/CCTV-Log/)

---

## What it does

1. **Photograph the camera** — point your phone at the CCTV camera or its signage. The photo timestamp and GPS coordinates are captured simultaneously, creating timestamped evidence of your presence at the location.

2. **Identify the operator** — the app searches a community-maintained registry of known cameras by GPS proximity (backed by Supabase + PostGIS). If the camera isn't in the registry yet, you can enter the operator details manually and optionally contribute them for others.

3. **Draft your SAR letter** — a legally correct Subject Access Request is generated automatically, citing Article 15 UK GDPR / Section 45 DPA 2018, referencing your photographic evidence, and requesting footage from a 30-minute window around the incident.

4. **Send from your own email** — the app opens your email client with the letter pre-composed. Nothing passes through any server. Your sent folder is your record.

---

## Your rights

Under **Article 15 of the UK GDPR** and **Section 45 of the Data Protection Act 2018**, you have the right to request a copy of any personal data held about you — including CCTV footage. The data controller must:

- Respond within **one calendar month**
- Provide the footage **free of charge** (unless the request is manifestly unfounded or excessive)
- Confirm in writing if the footage no longer exists or has been overwritten

This applies to cameras operated by businesses, local authorities, housing associations, and most other organisations.

> **Act quickly** — most CCTV systems overwrite footage within 7–31 days.

---

## Privacy

- Your name and email address are stored **on your device only** (browser localStorage). They are never transmitted anywhere.
- GPS coordinates are used in-session to search the camera registry and are not stored.
- Your letter is handed to your own email app via a `mailto:` link — this app never sees it after that.
- The camera registry contains only publicly available operator data — no user information whatsoever.

---

## Camera Registry

Camera and data controller information is stored in a Supabase PostgreSQL database with PostGIS for geo queries. Geo lookups are performed server-side — only cameras within the search radius are returned.

Contributions submitted via the in-app **Contribute** button go to a `pending_cameras` table and are reviewed before being promoted to the live registry. No account is required to contribute.

---

## Technical

- Pure vanilla JavaScript, ES6 modules — no frameworks, no build tools, no dependencies
- Progressive Web App — installable on iOS and Android, works offline after first load
- GPS via `navigator.geolocation`; reverse geocoding via [Nominatim](https://nominatim.openstreetmap.org/) (OpenStreetMap, free, no API key)
- Camera capture via `<input type="file" capture="environment">` — works on all mobile browsers
- Service worker caches all assets for offline use
- Camera registry: Supabase + PostGIS. Geo queries run server-side. Anon publishable key (read-only by RLS); contributions POST to `pending_cameras`
- Admin tool at `tools/admin.html` for reviewing and approving pending submissions (requires service role key, local use only)
- Database population scripts in `tools/` (see below)

### Database Population Pipeline

The camera registry is populated from two public data sources:

1. **ICO Register** — the UK Information Commissioner's register of fee payers (~1.3M organisations). `tools/import_ico.py` downloads and filters this for large organisations (Tier 3), known retail/food brands, and public sector bodies (NHS, police, councils, universities). Outputs `tools/ico_filtered.json`.

2. **OpenStreetMap** — `tools/import_osm.py` reads the filtered list, auto-derives brand names from corporate names (stripping "Limited", "PLC", etc.), queries the Overpass API for matching premises in GB, and upserts operators + cameras to Supabase. Handles Overpass failover, retries, and rate limiting.

```
cd tools
py -m venv ../.venv && ..\.venv\Scripts\activate
pip install -r requirements.txt
py import_ico.py                          # download + filter ICO register
py import_osm.py --dry-run --only aldi-stores  # preview one operator
py import_osm.py --only aldi-stores       # import one operator
py import_osm.py                          # import all mapped operators
```

A small `BRAND_OVERRIDES` dict in `import_osm.py` handles cases where the corporate name differs from the consumer brand (e.g. "T J Morris" → "Home Bargains", "Whitbread Group" → "Premier Inn"). The `operator` tag is also searched, covering car parks and infrastructure brands.

---

## Disclaimer

This app is a tool to help you exercise your existing legal rights. It is not legal advice. If you are unsure about your position, consult a solicitor or contact the [Information Commissioner's Office](https://ico.org.uk).

---

## Current State

Working PWA, live on GitHub Pages. Camera registry populated with ~30,000 locations across 33 major UK brands (supermarkets, retail, food chains, petrol stations, hotels, cinemas, gyms, car parks).

## Where It's Heading

- More operators (public sector: NHS, police, councils, universities)
- Batch SAR workflows (multiple cameras in one incident)
- Editable fields when approving submitted cameras in admin tool

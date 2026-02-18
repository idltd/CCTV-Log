# CCTV SAR

A Progressive Web App (PWA) for UK residents to submit Subject Access Requests for CCTV footage under the UK GDPR and Data Protection Act 2018.

**Live app:** [https://idltd.github.io/CCTV-Log/](https://idltd.github.io/CCTV-Log/)

---

## What it does

1. **Photograph the camera** — point your phone at the CCTV camera or its signage. The photo timestamp and GPS coordinates are captured simultaneously, creating timestamped evidence of your presence at the location.

2. **Identify the operator** — the app searches a [community-maintained registry](https://github.com/idltd/cctv-sar-db) of known cameras by GPS proximity. If the camera isn't in the registry yet, you can enter the operator details manually and optionally contribute them for others.

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
- The [camera registry](https://github.com/idltd/cctv-sar-db) contains only publicly available operator data — no user information whatsoever.

---

## Camera Registry

Camera and data controller information is sourced from a separate community-maintained repository: **[idltd/cctv-sar-db](https://github.com/idltd/cctv-sar-db)**

The app fetches the registry anonymously at startup and caches it locally for offline use. Contributions go via a reviewed GitHub Issue — no data goes live without approval.

---

## Technical

- Pure vanilla JavaScript, ES6 modules — no frameworks, no build tools, no dependencies
- Progressive Web App — installable on iOS and Android, works offline after first load
- GPS via `navigator.geolocation`; reverse geocoding via [Nominatim](https://nominatim.openstreetmap.org/) (OpenStreetMap, free, no API key)
- Camera capture via `<input type="file" capture="environment">` — works on all mobile browsers
- Service worker caches all assets for offline use
- Camera registry fetched from GitHub (anonymous HTTP GET, no token required)

---

## Disclaimer

This app is a tool to help you exercise your existing legal rights. It is not legal advice. If you are unsure about your position, consult a solicitor or contact the [Information Commissioner's Office](https://ico.org.uk).

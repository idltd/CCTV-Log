# CCTV-Log — UK CCTV SAR PWA

## What It Is
A Progressive Web App for UK residents to submit Subject Access Requests (SARs) for CCTV footage under UK GDPR (Article 15) and the Data Protection Act 2018. Everything runs locally in the browser — no server, no data leaves the device.

## How It Works
1. **Photograph the camera** — captures GPS coordinates and timestamp as evidence of presence
2. **Identify the operator** — searches the [community CCTV registry](https://github.com/idltd/cctv-sar-db) by GPS proximity; manual entry fallback
3. **Draft SAR letter** — auto-generates a legally correct SAR letter citing Article 15 UK GDPR / s.45 DPA 2018
4. **Send via email** — opens your email client with the letter pre-composed; nothing touches a server

## Architecture
Pure PWA — HTML, CSS, JavaScript, service worker. No build step, no framework.
- `index.html` — main app shell
- `js/` — app logic (camera, GPS, registry search, letter generation)
- `css/` — styles
- `data/` — local copy of camera registry (JSON)
- `manifest.json` + `sw.js` — PWA install and offline support

## Live App
https://idltd.github.io/CCTV-Log/

## Current State
Working PWA, live on GitHub Pages.

## Sister Project
`cctv-sar-db` — the community-maintained camera registry this app queries.

## Where It's Heading
- Richer camera registry (more operators, automated imports)
- Batch SAR workflows (multiple cameras in one incident)
- Android native wrapper via PoPA bridge for better camera/GPS access

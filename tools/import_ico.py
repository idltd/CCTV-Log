#!/usr/bin/env python3
"""
Download the ICO register of fee payers and filter for data controllers
likely to operate CCTV that the public encounters.

Outputs: tools/ico_filtered.json

Usage:
    cd tools
    py import_ico.py

The ICO register CSV is ~70 MB zipped / ~260 MB unzipped and updated daily.
Service role key page: https://supabase.com/dashboard/project/lyijydkwitjxbcxurkep/settings/api
"""

import csv
import io
import json
import os
import re
import sys
import tempfile
import zipfile
from datetime import date

import requests

# ── ICO download URL ──────────────────────────────────────────────────────────
# The ICO publishes a daily ZIP at a URL like:
#   /media2/cfnc5zdf/register-of-data-controllers-YYYY-MM-DD.zip
# The path segment (cfnc5zdf) is stable; only the date changes.
ICO_BASE = "https://ico.org.uk"
ICO_DOWNLOAD_PAGE = f"{ICO_BASE}/about-the-ico/what-we-do/register-of-fee-payers/download-the-register/"
CSV_FILENAME_INSIDE_ZIP = "register-of-data-controllers.csv"

# ── Known retail / food / leisure brands ──────────────────────────────────────
# These are matched case-insensitively against Organisation_name + Trading_names.
# Only the canonical operator name matters — we don't need every subsidiary.
KNOWN_BRANDS = [
    # Supermarkets
    "tesco", "asda", "sainsbury", "morrisons", "aldi", "lidl",
    "marks and spencer", "m&s ", "waitrose", "co-op group", "cooperative group",
    "iceland foods",
    # Retail
    "argos", "primark", "john lewis", "b&q", "homebase", "ikea",
    "next plc", "next retail", "h&m", "tk maxx", "tjx",
    "poundland", "wilko", "home bargains", "superdrug",
    "boots uk", "boots opticians", "currys", "dixons",
    "sports direct", "jd sports", "halfords",
    # Food & drink
    "mcdonald", "greggs", "costa coffee", "starbucks", "pret a manger",
    "kfc", "subway", "nando", "wetherspoon", "pizza hut", "domino's pizza",
    "burger king", "five guys",
    # Banks / financial
    "barclays", "hsbc", "lloyds bank", "natwest", "nationwide building",
    "santander uk", "virgin money", "halifax",
    # Telecoms
    "vodafone", "telefonica", "ee limited", "three uk", "bt group",
    # Petrol
    "shell uk", "bp ", "esso ", "texaco",
    # Leisure
    "odeon", "cineworld", "vue entertainment",
    "david lloyd", "puregym", "the gym group", "virgin active",
    # Parking / transport
    "national car parks", "ncp", "apcoa",
    "network rail", "transport for london", "transport for greater manchester",
    "british transport police",
    # Hotels
    "premier inn", "travelodge", "hilton",
    # Health
    "bupa", "nuffield health",
    # Amazon
    "amazon uk",
]

# ── Name patterns for public-sector / institutional controllers ───────────────
# These are regex patterns matched against Organisation_name.
NAME_PATTERNS = [
    # NHS
    r"\bnhs\b",
    r"\bhospital\b",
    r"\btrust\b.*\bnhs\b",
    r"\bnhs\b.*\btrust\b",
    r"\bhealth board\b",
    r"\bambulance\b",
    # Police
    r"\bpolice\b",
    r"\bconstabulary\b",
    # Councils
    r"\bcouncil\b",
    r"\bborough\b",
    r"\bcity of\b",
    r"\bcounty\b.*\bcouncil\b",
    # Transport
    r"\btransport for\b",
    # Universities
    r"\buniversity\b",
]

# Compiled for speed
_NAME_RE = [re.compile(p, re.IGNORECASE) for p in NAME_PATTERNS]

# ── Exclusions ────────────────────────────────────────────────────────────────
# Parish councils, community councils, town councils — too small, unlikely CCTV
EXCLUDE_PATTERNS = [
    re.compile(p, re.IGNORECASE) for p in [
        r"\bparish council\b",
        r"\bcommunity council\b",
        r"\btown council\b",
        r"\bparochial\b",
    ]
]


def find_zip_url():
    """Scrape the ICO download page to find today's ZIP URL."""
    print("Fetching ICO download page...")
    resp = requests.get(ICO_DOWNLOAD_PAGE, timeout=30)
    resp.raise_for_status()

    # Look for the dataset-download custom element
    # <dataset-download x-href="/media2/cfnc5zdf/register-of-data-controllers-2026-02-24.zip"
    match = re.search(r'x-href="([^"]+\.zip)"', resp.text)
    if match:
        return ICO_BASE + match.group(1)

    # Fallback: try today's date
    today = date.today().isoformat()
    return f"{ICO_BASE}/media2/cfnc5zdf/register-of-data-controllers-{today}.zip"


def download_register(zip_path):
    """Download the ICO register ZIP to a local path."""
    url = find_zip_url()
    print(f"Downloading: {url}")
    print("(This is ~70 MB, may take a minute...)")

    resp = requests.get(url, stream=True, timeout=120)
    resp.raise_for_status()

    total = int(resp.headers.get("content-length", 0))
    downloaded = 0

    with open(zip_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=1024 * 256):
            f.write(chunk)
            downloaded += len(chunk)
            if total:
                pct = downloaded * 100 // total
                print(f"\r  {downloaded:,} / {total:,} bytes ({pct}%)", end="", flush=True)
    print()
    print(f"Saved to: {zip_path}")


def make_slug(name):
    """Turn an organisation name into a URL-safe slug for operator IDs."""
    s = name.lower().strip()
    # Remove common suffixes
    for suffix in [" limited", " ltd", " plc", " llp", " inc", " uk"]:
        if s.endswith(suffix):
            s = s[: -len(suffix)].strip()
    # Remove parentheticals
    s = re.sub(r"\s*\([^)]*\)", "", s)
    # Keep only alphanumeric + spaces, then slugify
    s = re.sub(r"[^a-z0-9\s]", "", s)
    s = re.sub(r"\s+", "-", s.strip())
    # Trim excessive length
    return s[:60].rstrip("-")


def matches_brand(name, trading):
    """Check if name or trading names match any known brand."""
    combined = (name + " " + trading).lower()
    for b in KNOWN_BRANDS:
        if b in combined:
            return True
    return False


def matches_pattern(name):
    """Check if name matches institutional patterns (NHS, police, councils, etc.)."""
    for r in _NAME_RE:
        if r.search(name):
            return True
    return False


def is_excluded(name):
    """Check if name matches exclusion patterns."""
    for r in EXCLUDE_PATTERNS:
        if r.search(name):
            return True
    return False


def build_address(row):
    """Build a single postal address string from address fields."""
    parts = []
    for i in range(1, 6):
        v = row.get(f"Organisation_address_line_{i}", "").strip()
        if v:
            parts.append(v)
    pc = row.get("Organisation_postcode", "").strip()
    if pc:
        parts.append(pc)
    return ", ".join(parts)


def build_dpo_email(row):
    """Extract DPO/privacy email if present."""
    return row.get("DPO_or_Person_responsible_for_DP_Email", "").strip() or None


def filter_register(zip_path):
    """Read the ZIP, filter for interesting controllers, return list of dicts."""
    print(f"Reading {CSV_FILENAME_INSIDE_ZIP} from ZIP...")

    z = zipfile.ZipFile(zip_path)
    results = {}  # keyed by slug to deduplicate

    with z.open(CSV_FILENAME_INSIDE_ZIP) as f:
        reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8", errors="replace"))
        total = 0
        for row in reader:
            total += 1

            name = (row.get("Organisation_name") or "").strip()
            trading = (row.get("Trading_names") or "").strip()
            tier = (row.get("Payment_tier") or "").strip()

            if not name:
                continue

            # Exclusions first
            if is_excluded(name):
                continue

            # Must match at least one criterion
            matched = False

            # Tier 3 = largest organisations (automatic include)
            if tier == "Tier 3":
                matched = True

            # Known brands (any tier)
            if matches_brand(name, trading):
                matched = True

            # Institutional patterns (any tier, but we'll filter Tier 1 sole traders)
            if tier != "Tier 1" and matches_pattern(name):
                matched = True

            if not matched:
                continue

            slug = make_slug(name)
            if not slug:
                continue

            # Keep the first (or best) entry per slug
            if slug in results:
                # Prefer Tier 3 over others
                if tier == "Tier 3" and results[slug]["tier"] != "Tier 3":
                    pass  # overwrite below
                else:
                    continue

            results[slug] = {
                "slug": slug,
                "name": name,
                "ico_reg": row.get("Registration_number", "").strip(),
                "tier": tier,
                "privacy_email": build_dpo_email(row),
                "postal_address": build_address(row),
                "public_authority": row.get("Public_authority", "").strip() == "Y",
                "trading_names": trading if trading else None,
            }

        print(f"Scanned {total:,} records.")

    return sorted(results.values(), key=lambda r: r["name"].lower())


def main():
    out_file = os.path.join(os.path.dirname(__file__) or ".", "ico_filtered.json")

    # Use a temp file for the ZIP (or reuse if already downloaded today)
    zip_path = os.path.join(tempfile.gettempdir(), "ico_register.zip")

    if os.path.exists(zip_path):
        size_mb = os.path.getsize(zip_path) / (1024 * 1024)
        print(f"Found existing download: {zip_path} ({size_mb:.1f} MB)")
        print("Delete it to force re-download.")
    else:
        download_register(zip_path)

    results = filter_register(zip_path)

    # Stats
    tier_counts = {}
    for r in results:
        t = r["tier"]
        tier_counts[t] = tier_counts.get(t, 0) + 1

    print(f"\nFiltered to {len(results)} operators:")
    for t in sorted(tier_counts):
        print(f"  {t}: {tier_counts[t]}")

    with_email = sum(1 for r in results if r["privacy_email"])
    print(f"  With DPO email: {with_email}")

    # Write output
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    print(f"\nWritten to: {out_file}")
    print(f"Review the file, remove any junk entries, then run import_osm.py")


if __name__ == "__main__":
    main()

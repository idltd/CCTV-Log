#!/usr/bin/env python3
"""
Read ico_filtered.json and import operator locations from OpenStreetMap
into the Supabase database.

For each operator, the script:
  1. Auto-derives an OSM search name from the ICO organisation name
     (stripping corporate suffixes like "Limited", "PLC", "Group", etc.)
  2. Queries OSM Overpass for premises in GB tagged with that brand/name
  3. Upserts the operator and camera records to Supabase

A small overrides dict handles cases where the trading name differs from
the corporate name (e.g. "Whitbread Group" -> "Premier Inn").

Usage:
    cd tools
    py import_osm.py                    # all operators in ico_filtered.json
    py import_osm.py --only aldi-stores # single operator by slug
    py import_osm.py --dry-run          # preview without writing to Supabase
    py import_osm.py --dry-run --only asda-stores
    py import_osm.py --min-results 5    # skip operators with fewer than 5 hits

Service role key page: https://supabase.com/dashboard/project/lyijydkwitjxbcxurkep/settings/api
"""

import argparse
import getpass
import json
import os
import re
import sys
import time

import requests

# ── Config ────────────────────────────────────────────────────────────────────
SUPABASE_URL = "https://lyijydkwitjxbcxurkep.supabase.co"
# Multiple Overpass endpoints for failover
OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
OVERPASS_DELAY = 1.0  # seconds between Overpass queries
UPSERT_BATCH = 500

# ── Corporate suffixes to strip ───────────────────────────────────────────────
# Order matters: longer/more specific first, applied repeatedly.
STRIP_SUFFIXES = [
    "supermarkets", "restaurants", "holdings", "international",
    "professional services", "services", "solutions",
    "stores", "retail", "foods", "foodstore",
    "great britain", "cinemas", "entertainment", "hotels",
    "limited", "ltd", "plc", "llp", "inc",
    "group", "uk", "corp", "corporation",
    "& co", "and co",
]

# ── Name overrides ────────────────────────────────────────────────────────────
# Slug -> OSM brand name, for cases where the corporate name doesn't match
# the consumer-facing brand in OSM. Only truly necessary mismatches go here.
BRAND_OVERRIDES = {
    # Corporate parent != trading brand
    "whitbread-group":              "Premier Inn",
    "whitbread":                    "Premier Inn",
    "telefonica-uk":                "O2",
    "telefonica":                   "O2",
    "tjx-uk":                       "TK Maxx",
    "tjx":                          "TK Maxx",
    "dixons-carphone":              "Currys",
    "dixons":                       "Currys",
    "ee":                           "EE",
    "three-uk":                     "Three",
    "t-j-morris":                   "Home Bargains",
    "frasers-group":                "Sports Direct",
    "subway-realty":                "Subway",
    "five-guys-jv":                 "Five Guys",
    # Name divergence (actual ICO slugs)
    "wm-morrison-supermarkets":     "Morrisons",
    "wm-morrison":                  "Morrisons",
    "sainsburys-supermarkets":      "Sainsbury's",
    "sainsburys":                   "Sainsbury's",
    "marks-and-spencer-group":      "Marks & Spencer",
    "marks-and-spencer":            "Marks & Spencer",
    "cooperative-group":            "Co-op",
    "co-operative-group":           "Co-op",
    "central-england-cooperative":  "Co-op",
    "the-midcounties-cooperative":  "Co-op",
    "the-southern-cooperative":     "Co-op",
    "iceland-foods":                "Iceland",
    "national-car-parks":           "NCP",
    "j-d-wetherspoon":              "Wetherspoon",
    "jd-wetherspoon":               "Wetherspoon",
    "dominos-pizza-uk-ireland":     "Domino's",
    "dominos-pizza-group":          "Domino's",
    "dominos-pizza":                "Domino's",
    "costa":                        "Costa Coffee",
    "starbucks-coffee-company":     "Starbucks",
    "starbucks-coffee":             "Starbucks",
    "mcdonalds-restaurants":        "McDonald's",
    "mcdonalds":                    "McDonald's",
    "nandos-chickenland":           "Nando's",
    "nandos":                       "Nando's",
    "pret-a-manger-europe":         "Pret A Manger",
    "pret-a-manger":                "Pret A Manger",
    "superdrug-stores":             "Superdrug",
    "primark-stores":               "Primark",
    "pure-gym":                     "PureGym",
    "cineworld-cinemas":            "Cineworld",
    "odeon-cinemas":                "Odeon",
    "jd-sports-fashion":            "JD Sports",
    "jd-sports":                    "JD Sports",
    "sports-direct-international":  "Sports Direct",
    "sports-direct":                "Sports Direct",
    "the-gym-group":                "The Gym",
    "the-gym":                      "The Gym",
    "vue-entertainment":            "Vue",
    "virgin-active":                "Virgin Active",
    "virgin-money":                 "Virgin Money",
    "nationwide-building-society":  "Nationwide",
    "bt-group":                     "BT",
    "bp-oil":                       "BP",
    "esso-petroleum-company":       "Esso",
    "esso-petroleum":               "Esso",
    "shell-uk":                     "Shell",
}

# ── Slugs to skip ─────────────────────────────────────────────────────────────
# Operators that won't have meaningful physical premises in OSM
# (holding companies, financial/insurance entities, online-only, etc.)
SKIP_SLUGS = set()
# Populated at runtime if needed; can also be loaded from a file.


def clean_name_for_search(name):
    """
    Derive an OSM search name from an ICO corporate name.

    "ALDI Stores Limited" -> "Aldi"
    "Greggs PLC"          -> "Greggs"
    "B&Q Limited"         -> "B&Q"
    """
    s = name.strip()

    # Remove parenthetical content: "Next (Retail) Limited" -> "Next Limited"
    s = re.sub(r"\s*\([^)]*\)", "", s)

    # Strip corporate suffixes (case-insensitive, repeated until stable)
    prev = None
    while prev != s:
        prev = s
        for suffix in STRIP_SUFFIXES:
            pattern = re.compile(r"\s+" + re.escape(suffix) + r"$", re.IGNORECASE)
            s = pattern.sub("", s)
        s = s.strip().rstrip(",").strip()

    # Title-case if ALL CAPS, preserve mixed case otherwise
    if s == s.upper() and len(s) > 3:
        s = s.title()

    return s.strip()


def build_overpass_query(brand_name):
    """
    Build an Overpass QL query to find branded/named premises in GB.
    Uses regex on both brand and name tags (case-insensitive) to handle
    minor variations like "Wetherspoon" vs "Wetherspoons".
    No type constraint -- we want everything tagged with this brand.
    """
    regex_escaped = re.escape(brand_name).replace('"', '\\"')

    # Allow optional trailing "s" and "'s" for pluralisation mismatches
    pattern = f"^{regex_escaped}('?s)?$"

    query = (
        "[out:json][timeout:180];\n"
        f'area["ISO3166-1"="GB"]->.gb;\n'
        "(\n"
        f'  nw["brand"~"{pattern}",i](area.gb);\n'
        f'  nw["name"~"{pattern}",i](area.gb);\n'
        ");\n"
        "out center;"
    )
    return query


def query_overpass(query, retries=2):
    """Send a query to the Overpass API with failover across endpoints."""
    last_err = None
    for attempt in range(retries + 1):
        url = OVERPASS_URLS[attempt % len(OVERPASS_URLS)]
        try:
            resp = requests.post(url, data={"data": query}, timeout=200)
            resp.raise_for_status()
            data = resp.json()

            if "remark" in data and "runtime error" in data["remark"]:
                raise RuntimeError(f"Overpass error: {data['remark']}")

            return data.get("elements", [])
        except (requests.RequestException, RuntimeError) as e:
            last_err = e
            if attempt < retries:
                wait = 5 * (attempt + 1)
                print(f"  Retry {attempt+1}/{retries} in {wait}s ({e})...")
                time.sleep(wait)
    raise last_err


def elements_to_cameras(elements, slug):
    """Convert Overpass elements to camera records."""
    cameras = []
    seen_ids = set()

    for el in elements:
        osm_type = el["type"]  # "node" or "way"
        osm_id = el["id"]

        # For ways, use the center point
        if osm_type == "way":
            center = el.get("center", {})
            lat = center.get("lat")
            lng = center.get("lon")
            cam_id = f"{slug}-osm-w{osm_id}"
        else:
            lat = el.get("lat")
            lng = el.get("lon")
            cam_id = f"{slug}-osm-n{osm_id}"

        if not lat or not lng:
            continue

        if cam_id in seen_ids:
            continue
        seen_ids.add(cam_id)

        # Build a human-readable location description
        tags = el.get("tags", {})
        name = tags.get("name", "")
        addr_parts = []
        for k in ("addr:housename", "addr:housenumber", "addr:street",
                   "addr:city", "addr:postcode"):
            v = tags.get(k, "").strip()
            if v:
                addr_parts.append(v)
        addr = ", ".join(addr_parts)

        if name and addr:
            desc = f"{name}, {addr}"
        elif name:
            desc = name
        elif addr:
            desc = addr
        else:
            desc = ""

        cameras.append({
            "id": cam_id,
            "lat": round(lat, 7),
            "lng": round(lng, 7),
            "location_desc": desc[:200],
            "operator_id": slug,
        })

    return cameras


def get_search_name(op):
    """
    Get the OSM search name for an operator.
    Uses BRAND_OVERRIDES if available, otherwise auto-derives from ICO name.
    Also checks trading_names for a better match.
    """
    slug = op["slug"]

    # Explicit override takes priority
    if slug in BRAND_OVERRIDES:
        return BRAND_OVERRIDES[slug]

    # Try cleaning the organisation name
    cleaned = clean_name_for_search(op["name"])

    # If trading names are available and shorter/cleaner, prefer them
    trading = op.get("trading_names") or ""
    if trading:
        # Trading names are pipe-separated in ICO data
        first_trading = trading.split("|")[0].strip().rstrip(".")
        if first_trading:
            cleaned_trading = clean_name_for_search(first_trading)
            # Prefer trading name if it's meaningfully different and shorter
            if (cleaned_trading and
                    len(cleaned_trading) < len(cleaned) and
                    cleaned_trading.lower() != cleaned.lower()):
                return cleaned_trading

    return cleaned


# ── Supabase helpers ──────────────────────────────────────────────────────────

def supa_headers(key):
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def upsert_operator(op, key, dry_run=False):
    """Upsert a single operator record."""
    payload = {
        "id": op["slug"],
        "name": op["name"],
        "ico_reg": op.get("ico_reg"),
        "privacy_email": op.get("privacy_email"),
        "postal_address": op.get("postal_address"),
    }

    if dry_run:
        print(f"  [DRY RUN] Would upsert operator: {payload['id']} ({payload['name']})")
        return

    resp = requests.post(
        f"{SUPABASE_URL}/rest/v1/operators",
        headers={
            **supa_headers(key),
            "Prefer": "resolution=merge-duplicates,return=representation",
        },
        json=payload,
        timeout=30,
    )
    if not resp.ok:
        print(f"  ERROR upserting operator {payload['id']}: {resp.status_code} {resp.text[:200]}")
    else:
        print(f"  Upserted operator: {payload['id']}")


def upsert_cameras(cameras, key, dry_run=False):
    """Upsert cameras in batches."""
    if dry_run:
        print(f"  [DRY RUN] Would upsert {len(cameras)} cameras")
        if cameras:
            print(f"    First: {cameras[0]['id']} at {cameras[0]['lat']},{cameras[0]['lng']}")
            print(f"    Last:  {cameras[-1]['id']} at {cameras[-1]['lat']},{cameras[-1]['lng']}")
        return

    for i in range(0, len(cameras), UPSERT_BATCH):
        batch = cameras[i : i + UPSERT_BATCH]
        resp = requests.post(
            f"{SUPABASE_URL}/rest/v1/cameras",
            headers={
                **supa_headers(key),
                "Prefer": "resolution=merge-duplicates,return=representation",
            },
            json=batch,
            timeout=60,
        )
        if not resp.ok:
            print(f"  ERROR upserting cameras batch {i}-{i+len(batch)}: "
                  f"{resp.status_code} {resp.text[:200]}")
            continue

        batch_end = min(i + UPSERT_BATCH, len(cameras))
        print(f"  Upserted cameras {i+1}-{batch_end} of {len(cameras)}")


def main():
    parser = argparse.ArgumentParser(
        description="Import operator locations from OSM into Supabase",
        epilog="Service role key: "
               "https://supabase.com/dashboard/project/lyijydkwitjxbcxurkep/settings/api",
    )
    parser.add_argument("--only", metavar="SLUG",
                        help="Process only this operator slug")
    parser.add_argument("--dry-run", action="store_true",
                        help="Query OSM but don't write to Supabase")
    parser.add_argument("--input", default=None,
                        help="Path to filtered JSON (default: tools/ico_filtered.json)")
    parser.add_argument("--min-results", type=int, default=0,
                        help="Skip operators with fewer than N OSM results (default: 0)")
    parser.add_argument("--show-names", action="store_true",
                        help="Show derived search names and exit (no queries)")
    args = parser.parse_args()

    # Find input file
    script_dir = os.path.dirname(__file__) or "."
    input_file = args.input or os.path.join(script_dir, "ico_filtered.json")

    if not os.path.exists(input_file):
        print(f"ERROR: {input_file} not found.")
        print("Run import_ico.py first to generate it.")
        sys.exit(1)

    with open(input_file, encoding="utf-8") as f:
        operators = json.load(f)

    print(f"Loaded {len(operators)} operators from {input_file}")

    # Filter to --only if specified
    if args.only:
        operators = [op for op in operators if op["slug"] == args.only]
        if not operators:
            print(f"ERROR: No operator with slug '{args.only}' found in {input_file}")
            sys.exit(1)

    # Derive search names for all operators
    for op in operators:
        op["_search_name"] = get_search_name(op)

    # --show-names mode: just print the mapping and exit
    if args.show_names:
        print(f"\n{'Slug':<45} {'Search name':<30} {'ICO name'}")
        print("-" * 110)
        for op in operators:
            override = " [override]" if op["slug"] in BRAND_OVERRIDES else ""
            print(f"{op['slug']:<45} {op['_search_name']:<30} {op['name'][:35]}{override}")
        return

    # Filter out operators with very short/empty search names
    queryable = [op for op in operators
                 if len(op["_search_name"]) >= 2
                 and op["slug"] not in SKIP_SLUGS]

    print(f"{len(queryable)} operators to query")

    if not queryable:
        print("\nNo operators to process.")
        sys.exit(0)

    # Get Supabase key (unless dry run)
    key = None
    if not args.dry_run:
        key = getpass.getpass(
            "Supabase service role key "
            "(https://supabase.com/dashboard/project/lyijydkwitjxbcxurkep/settings/api): "
        )
        if not key.strip():
            print("ERROR: No key provided.")
            sys.exit(1)
        key = key.strip()

    # Process each operator
    total_cameras = 0
    total_operators = 0
    no_results = []

    for i, op in enumerate(queryable):
        slug = op["slug"]
        search_name = op["_search_name"]

        print(f"\n[{i+1}/{len(queryable)}] {op['name']}")
        print(f"  Search name: \"{search_name}\"")

        # Build and run Overpass query
        query = build_overpass_query(search_name)

        try:
            elements = query_overpass(query)
        except (requests.RequestException, RuntimeError) as e:
            print(f"  ERROR: {e}")
            if i < len(queryable) - 1:
                time.sleep(OVERPASS_DELAY)
            continue

        cameras = elements_to_cameras(elements, slug)
        print(f"  {len(elements)} OSM elements -> {len(cameras)} cameras")

        if len(cameras) < args.min_results:
            if cameras:
                print(f"  Skipped (below --min-results {args.min_results})")
            else:
                no_results.append(slug)
            if i < len(queryable) - 1:
                time.sleep(OVERPASS_DELAY)
            continue

        # Upsert to Supabase
        upsert_operator(op, key, dry_run=args.dry_run)
        upsert_cameras(cameras, key, dry_run=args.dry_run)
        total_cameras += len(cameras)
        total_operators += 1

        # Rate limit between Overpass queries
        if i < len(queryable) - 1:
            time.sleep(OVERPASS_DELAY)

    # Summary
    print(f"\n{'='*60}")
    print(f"Done. {total_operators} operators, {total_cameras} cameras total.")
    if no_results:
        print(f"\n{len(no_results)} operators returned 0 results:")
        for s in no_results[:20]:
            print(f"  {s}")
        if len(no_results) > 20:
            print(f"  ... and {len(no_results) - 20} more")
    if args.dry_run:
        print("\n(Dry run -- nothing was written to Supabase)")


if __name__ == "__main__":
    main()

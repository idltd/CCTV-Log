#!/usr/bin/env python3
"""
Read ico_filtered.json and import operator locations from OpenStreetMap
into the Supabase database.

Uses the Overpass API to find premises in Great Britain for each operator,
then upserts operators and cameras to Supabase.

Usage:
    cd tools
    py import_osm.py                    # all operators in ico_filtered.json
    py import_osm.py --only aldi        # single operator by slug
    py import_osm.py --dry-run          # preview without writing to Supabase
    py import_osm.py --dry-run --only asda

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
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OVERPASS_DELAY = 1.0  # seconds between Overpass queries
UPSERT_BATCH = 500

# ── OSM brand/name mapping ────────────────────────────────────────────────────
# Maps operator slugs to Overpass search strategies.
# "brand" uses brand:wikidata or brand tag; "name" uses name tag.
# "amenity"/"shop" constrains the OSM feature type.
#
# Only operators with an entry here will be queried.
# Add new mappings as needed — operators without a mapping are skipped.

OSM_QUERIES = {
    # ── Supermarkets ──────────────────────────────────────────────────────────
    "tesco-stores":     {"brand": "Tesco",              "shop": "supermarket"},
    "tesco":            {"brand": "Tesco",              "shop": "supermarket"},
    "asda-stores":      {"brand": "Asda",               "shop": "supermarket"},
    "asda-group":       {"brand": "Asda",               "shop": "supermarket"},
    "asda":             {"brand": "Asda",               "shop": "supermarket"},
    "sainsburys-supermarkets": {"brand": "Sainsbury's",  "shop": "supermarket"},
    "sainsburys":       {"brand": "Sainsbury's",         "shop": "supermarket"},
    "wm-morrison-supermarkets": {"brand": "Morrisons",  "shop": "supermarket"},
    "morrisons":        {"brand": "Morrisons",          "shop": "supermarket"},
    "aldi-stores":      {"brand": "Aldi",               "shop": "supermarket"},
    "aldi":             {"brand": "Aldi",               "shop": "supermarket"},
    "lidl-great-britain": {"brand": "Lidl",             "shop": "supermarket"},
    "lidl":             {"brand": "Lidl",               "shop": "supermarket"},
    "marks-and-spencer": {"brand": "Marks & Spencer",   "shop": "supermarket"},
    "waitrose":         {"brand": "Waitrose",           "shop": "supermarket"},
    "iceland-foods":    {"brand": "Iceland",            "shop": "supermarket"},
    "co-operative-group": {"brand": "Co-op",            "shop": "supermarket"},

    # ── Retail ────────────────────────────────────────────────────────────────
    "argos":            {"brand": "Argos",              "shop": "general"},
    "primark":          {"brand": "Primark",            "shop": "clothes"},
    "john-lewis":       {"brand": "John Lewis",         "shop": "department_store"},
    "bq":               {"brand": "B&Q",                "shop": "doityourself"},
    "homebase":         {"brand": "Homebase",           "shop": "doityourself"},
    "ikea":             {"brand": "IKEA",               "shop": "furniture"},
    "next":             {"brand": "Next",               "shop": "clothes"},
    "tk-maxx":          {"brand": "TK Maxx",            "shop": "clothes"},
    "poundland":        {"brand": "Poundland",          "shop": "variety_store"},
    "superdrug":        {"brand": "Superdrug",          "shop": "chemist"},
    "boots":            {"brand": "Boots",              "shop": "chemist"},
    "currys":           {"brand": "Currys",             "shop": "electronics"},
    "sports-direct":    {"brand": "Sports Direct",      "shop": "sports"},
    "jd-sports":        {"brand": "JD Sports",          "shop": "sports"},
    "halfords":         {"brand": "Halfords",           "shop": "car_parts"},
    "home-bargains":    {"brand": "Home Bargains",      "shop": "variety_store"},

    # ── Food & drink ──────────────────────────────────────────────────────────
    "mcdonalds-restaurants": {"brand": "McDonald's",    "amenity": "fast_food"},
    "mcdonalds":        {"brand": "McDonald's",         "amenity": "fast_food"},
    "greggs":           {"brand": "Greggs",             "shop": "bakery"},
    "costa":            {"brand": "Costa Coffee",       "amenity": "cafe"},
    "starbucks-coffee":  {"brand": "Starbucks",         "amenity": "cafe"},
    "starbucks":        {"brand": "Starbucks",          "amenity": "cafe"},
    "pret-a-manger":    {"brand": "Pret A Manger",      "amenity": "cafe"},
    "kfc":              {"brand": "KFC",                "amenity": "fast_food"},
    "kfc-great-britain": {"brand": "KFC",               "amenity": "fast_food"},
    "subway":           {"brand": "Subway",             "amenity": "fast_food"},
    "nandos":           {"brand": "Nando's",            "amenity": "restaurant"},
    "jd-wetherspoon":   {"brand": "Wetherspoons",       "amenity": "pub"},
    "wetherspoon":      {"brand": "Wetherspoons",       "amenity": "pub"},
    "pizza-hut":        {"brand": "Pizza Hut",          "amenity": "restaurant"},
    "dominos-pizza":    {"brand": "Domino's",           "amenity": "fast_food"},
    "burger-king":      {"brand": "Burger King",        "amenity": "fast_food"},

    # ── Petrol ────────────────────────────────────────────────────────────────
    "shell":            {"brand": "Shell",              "amenity": "fuel"},
    "bp":               {"brand": "BP",                 "amenity": "fuel"},
    "esso":             {"brand": "Esso",               "amenity": "fuel"},
    "texaco":           {"brand": "Texaco",             "amenity": "fuel"},

    # ── Parking ───────────────────────────────────────────────────────────────
    "national-car-parks": {"brand": "NCP",              "amenity": "parking"},

    # ── Leisure ───────────────────────────────────────────────────────────────
    "odeon-cinemas":    {"brand": "Odeon",              "amenity": "cinema"},
    "cineworld":        {"brand": "Cineworld",          "amenity": "cinema"},
    "vue-entertainment": {"brand": "Vue",              "amenity": "cinema"},
    "puregym":          {"brand": "PureGym",            "leisure": "fitness_centre"},
    "the-gym-group":    {"brand": "The Gym",            "leisure": "fitness_centre"},

    # ── Hotels ────────────────────────────────────────────────────────────────
    "whitbread-group":  {"brand": "Premier Inn",        "tourism": "hotel"},
    "premier-inn":      {"brand": "Premier Inn",        "tourism": "hotel"},
    "travelodge-hotels": {"brand": "Travelodge",       "tourism": "hotel"},
    "travelodge":       {"brand": "Travelodge",        "tourism": "hotel"},
}


def build_overpass_query(cfg):
    """Build an Overpass QL query to find branded premises in Great Britain."""
    brand = cfg["brand"]

    # Determine which tag to filter on (shop, amenity, leisure, tourism)
    type_filters = []
    for tag in ("shop", "amenity", "leisure", "tourism"):
        if tag in cfg:
            type_filters.append(f'["{tag}"="{cfg[tag]}"]')

    # If no type filter, just search by brand name
    if not type_filters:
        type_filters = [""]

    # Build query parts for nodes and ways
    # Use exact match on brand tag (fast), regex only on name tag (fallback)
    parts = []
    for tf in type_filters:
        # Exact brand match (fast, covers most mapped chains)
        parts.append(f'  nw["brand"="{brand}"]{tf}(area.gb);')
        # Regex name match (catches entries tagged with name but no brand tag)
        parts.append(f'  nw["name"~"^{re.escape(brand)}$",i]{tf}(area.gb);')

    query = (
        "[out:json][timeout:180];\n"
        "area[\"ISO3166-1\"=\"GB\"]->.gb;\n"
        "(\n"
        + "\n".join(parts)
        + "\n);\n"
        "out center;"
    )
    return query


def query_overpass(query):
    """Send a query to the Overpass API and return the elements."""
    resp = requests.post(OVERPASS_URL, data={"data": query}, timeout=200)
    resp.raise_for_status()
    data = resp.json()
    return data.get("elements", [])


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
        return 0, len(cameras)

    new_count = 0
    skip_count = 0

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

        result = resp.json()
        new_count += len(result)
        batch_end = min(i + UPSERT_BATCH, len(cameras))
        print(f"  Upserted cameras {i+1}-{batch_end} of {len(cameras)}")

    return new_count, skip_count


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

    # Filter to operators that have OSM query mappings
    queryable = [op for op in operators if op["slug"] in OSM_QUERIES]
    skipped = [op for op in operators if op["slug"] not in OSM_QUERIES]

    print(f"{len(queryable)} operators have OSM query mappings")
    if skipped and not args.only:
        print(f"{len(skipped)} operators skipped (no OSM mapping)")

    if not queryable:
        print("\nNo operators to process. Add mappings to OSM_QUERIES in this script.")
        if args.only:
            print(f"Slug '{args.only}' needs a mapping in OSM_QUERIES dict.")
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

    for i, op in enumerate(queryable):
        slug = op["slug"]
        cfg = OSM_QUERIES[slug]

        print(f"\n[{i+1}/{len(queryable)}] {op['name']} (slug: {slug})")

        # Build and run Overpass query
        query = build_overpass_query(cfg)
        print(f"  Querying Overpass for brand='{cfg['brand']}'...")

        try:
            elements = query_overpass(query)
        except requests.RequestException as e:
            print(f"  ERROR querying Overpass: {e}")
            if i < len(queryable) - 1:
                print(f"  Waiting {OVERPASS_DELAY}s before next query...")
                time.sleep(OVERPASS_DELAY)
            continue

        cameras = elements_to_cameras(elements, slug)
        print(f"  Found {len(elements)} OSM elements -> {len(cameras)} camera records")

        if not cameras:
            if i < len(queryable) - 1:
                time.sleep(OVERPASS_DELAY)
            continue

        # Upsert to Supabase
        upsert_operator(op, key, dry_run=args.dry_run)
        new, skipped_count = upsert_cameras(cameras, key, dry_run=args.dry_run)
        total_cameras += len(cameras)
        total_operators += 1

        # Rate limit between Overpass queries
        if i < len(queryable) - 1:
            print(f"  Waiting {OVERPASS_DELAY}s before next query...")
            time.sleep(OVERPASS_DELAY)

    # Summary
    print(f"\n{'='*60}")
    print(f"Done. Processed {total_operators} operators, {total_cameras} cameras total.")
    if args.dry_run:
        print("(Dry run -- nothing was written to Supabase)")


if __name__ == "__main__":
    main()

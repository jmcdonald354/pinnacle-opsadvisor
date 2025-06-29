#!/usr/bin/env python3
from dotenv import load_dotenv
import os
import sys
import time
import requests
from supabase import create_client, Client

# ──────────────────────────────────────────────────────────────────────────────
# 1) Load your .env file
# ──────────────────────────────────────────────────────────────────────────────
load_dotenv("keys.env")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
SERPAPI_KEY  = os.getenv("SERPAPI_KEY")

if not (SUPABASE_URL and SUPABASE_KEY and SERPAPI_KEY):
    print("❌ ERROR: please define SUPABASE_URL, SUPABASE_KEY & SERPAPI_KEY in keys.env")
    sys.exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ──────────────────────────────────────────────────────────────────────────────
# 2) Fetch all vendors missing a website_url
# ──────────────────────────────────────────────────────────────────────────────
resp = (
    supabase
    .from_("vendor_catalog")
    .select("id, vendor_name")
    .is_("website_url", None)
    .execute()
)

# support both supabase-py versions
err = getattr(resp, "error", None) or getattr(resp, "error_message", None)
if err:
    print("❌ Supabase fetch error:", err)
    sys.exit(1)

vendors = resp.data or []
print(f"Found {len(vendors)} vendor(s) without a website_url")
if not vendors:
    print("Nothing to do.")
    sys.exit(0)

# ──────────────────────────────────────────────────────────────────────────────
# 3) Loop through each vendor, lookup & update
# ──────────────────────────────────────────────────────────────────────────────
for v in vendors:
    vid, name = v["id"], v["vendor_name"]
    print(f"→ Looking up {name!r}…", end=" ")

    link = None
    for attempt in (1, 2):
        try:
            r = requests.get(
                "https://serpapi.com/search.json",
                params={
                    "engine":  "google",
                    "q":       name,
                    "api_key": SERPAPI_KEY,
                    "num":     1,
                },
                timeout=10
            )
            r.raise_for_status()
            data = r.json()
            link = data.get("organic_results", [{}])[0].get("link")
            break
        except requests.exceptions.Timeout:
            print(f"(timeout, retry {attempt})", end=" ")
            time.sleep(1)
        except Exception as e:
            print(f"(error: {e})")
            break

    if not link:
        print("no result → CALL FOR PRICING")
        link = "CALL FOR PRICING"
    else:
        print("saved:", link)

    upd = (
        supabase
        .from_("vendor_catalog")
        .update({"website_url": link})
        .eq("id", vid)
        .execute()
    )
    uerr = getattr(upd, "error", None) or getattr(upd, "error_message", None)
    if uerr:
        print("   Supabase update error:", uerr)

print("✅ Done.")

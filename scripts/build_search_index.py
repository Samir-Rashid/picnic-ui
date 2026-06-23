#!/usr/bin/env python3
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
OUTPUT_PATH = ROOT / "web" / "public" / "menu.json"

DIETARY_RULES: tuple[tuple[str, str], ...] = (
    ("gluten-free", "gf"),
    ("gluten free", "gf"),
    ("vegan", "vegan"),
    ("vegetarian", "vegetarian"),
    ("dairy-free", "dairy-free"),
    ("dairy free", "dairy-free"),
    ("halal", "halal"),
    ("spicy", "spicy"),
    ("keto", "keto"),
)


def parse_dietary_tags(name: str, description: str) -> list[str]:
    text = f"{name} {description}".lower()
    tags: list[str] = []
    for phrase, tag in DIETARY_RULES:
        if phrase in text and tag not in tags:
            tags.append(tag)
    return tags


def is_available(item: dict) -> bool:
    if item.get("is_suspended"):
        return False
    status = item.get("item_status") or ""
    return status == "ITEM_STATUS_AVAILABLE"


def load_store_lookup() -> dict[str, dict]:
    manifest = json.loads((DATA_DIR / "manifest.json").read_text())
    lookup: dict[str, dict] = {}
    for store in manifest.get("stores", []):
        store_id = store["store_id"]
        menu_path = DATA_DIR / "menus" / f"{store_id}.json"
        logo_url = None
        if menu_path.exists():
            menu_data = json.loads(menu_path.read_text())
            logo_url = menu_data.get("logo_url")
        lookup[store_id] = {
            "name": store.get("name") or store.get("brand_name") or store_id,
            "brand_slug": store.get("brand_slug"),
            "logo_url": logo_url,
        }
    return lookup


def build_index() -> dict:
    flat_path = DATA_DIR / "all_items_flat.json"
    manifest_path = DATA_DIR / "manifest.json"
    if not flat_path.exists():
        raise FileNotFoundError(f"Missing {flat_path}. Run: uv run python main.py scrape")

    items_raw = json.loads(flat_path.read_text())
    manifest = json.loads(manifest_path.read_text())
    stores_by_id = load_store_lookup()

    items = []
    for raw in items_raw:
        store_id = raw.get("store_id")
        store = stores_by_id.get(store_id, {})
        store_name = store.get("name") or store_id or "Unknown"
        name = (raw.get("name") or "").strip()
        description = (raw.get("description") or "").strip()
        search_text = " ".join(
            part.lower()
            for part in (name, description, store_name)
            if part
        )

        items.append(
            {
                "id": raw.get("id"),
                "name": name,
                "description": description,
                "price": raw.get("price"),
                "storeId": store_id,
                "storeName": store_name,
                "storeLogo": store.get("logo_url"),
                "photoUrl": raw.get("photo_url"),
                "available": is_available(raw),
                "dietaryTags": parse_dietary_tags(name, description),
                "searchText": search_text,
            }
        )

    stores = [
        {
            "id": store_id,
            "name": info["name"],
            "logoUrl": info.get("logo_url"),
        }
        for store_id, info in sorted(stores_by_id.items(), key=lambda row: row[1]["name"].lower())
    ]

    scraped_at = manifest.get("delivery_window_start")
    if scraped_at:
        try:
            dt = datetime.fromisoformat(scraped_at.replace("Z", "+00:00"))
            scraped_label = dt.astimezone(timezone.utc).strftime("%B %d, %Y")
        except ValueError:
            scraped_label = scraped_at
    else:
        scraped_label = datetime.now(timezone.utc).strftime("%B %d, %Y")

    return {
        "meta": {
            "itemCount": len(items),
            "storeCount": len(stores),
            "availableCount": sum(1 for item in items if item["available"]),
            "scrapedAt": scraped_label,
            "priceMax": max((item["price"] or 0) for item in items),
        },
        "stores": stores,
        "items": items,
    }


def main() -> None:
    payload = build_index()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"Wrote {OUTPUT_PATH} ({len(payload['items'])} items, {len(payload['stores'])} stores)")


if __name__ == "__main__":
    main()
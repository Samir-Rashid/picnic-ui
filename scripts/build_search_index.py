#!/usr/bin/env python3
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
FEATURED_PATH = ROOT / "config" / "featured_items.json"
OUTPUT_PATH = ROOT / "web" / "public" / "menu.json"
MODIFIERS_OUTPUT_PATH = ROOT / "web" / "public" / "modifiers.json"

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


def load_featured_lookup() -> dict[str, int]:
    if not FEATURED_PATH.exists():
        return {}

    payload = json.loads(FEATURED_PATH.read_text())
    entries = payload.get("items", payload if isinstance(payload, list) else [])
    lookup: dict[str, int] = {}
    for index, entry in enumerate(entries):
        if isinstance(entry, str):
            item_id = entry
        else:
            item_id = entry.get("id")
        if item_id and item_id not in lookup:
            lookup[item_id] = index
    return lookup


def build_store_url(
    brand_slug: str | None,
    location_slug: str | None,
    store_id: str,
) -> str | None:
    if not brand_slug or not location_slug:
        return None
    return f"https://order.trypicnic.com/s/{brand_slug}/{location_slug}/{store_id}"


def build_item_url(
    brand_slug: str | None,
    location_slug: str | None,
    store_id: str,
    item_name: str,
    item_id: str,
) -> str | None:
    if not brand_slug or not location_slug or not item_name or not item_id:
        return None
    name_segment = quote(item_name, safe="")
    return (
        f"https://order.trypicnic.com/s/{brand_slug}/{location_slug}/"
        f"{store_id}/{name_segment}/{item_id}"
    )


def item_price_value(item: dict | None) -> float:
    if not item:
        return 0.0
    price = item.get("price")
    return float(price) if price is not None else 0.0


def lookup_item(
    item_id: str,
    items_by_id: dict[str, dict],
    modifier_items_by_id: dict[str, dict],
) -> dict | None:
    return items_by_id.get(item_id) or modifier_items_by_id.get(item_id)


def min_cost_for_group(
    group: dict,
    items_by_id: dict[str, dict],
    modifier_items_by_id: dict[str, dict],
    groups_by_id: dict[str, dict],
    cache: dict[str, float],
) -> float:
    selection = group.get("selectionData") or {}
    min_choices = int(selection.get("minimumNumberOfChoices") or 0)
    if min_choices <= 0:
        return 0.0

    option_costs: list[float] = []
    for item_id in group.get("itemIds") or []:
        option_costs.append(
            min_cost_for_item(
                item_id,
                items_by_id,
                modifier_items_by_id,
                groups_by_id,
                cache,
            )
        )
    if not option_costs:
        return 0.0

    option_costs.sort()
    return sum(option_costs[:min_choices])


def min_cost_for_item(
    item_id: str,
    items_by_id: dict[str, dict],
    modifier_items_by_id: dict[str, dict],
    groups_by_id: dict[str, dict],
    cache: dict[str, float],
) -> float:
    if item_id in cache:
        return cache[item_id]

    item = lookup_item(item_id, items_by_id, modifier_items_by_id)
    if not item:
        cache[item_id] = 0.0
        return 0.0

    total = item_price_value(item)
    for group_id in item.get("modifier_group_ids") or []:
        group = groups_by_id.get(group_id)
        if group:
            total += min_cost_for_group(
                group,
                items_by_id,
                modifier_items_by_id,
                groups_by_id,
                cache,
            )

    cache[item_id] = total
    return total


def build_modifier_groups(
    group_ids: list[str],
    items_by_id: dict[str, dict],
    modifier_items_by_id: dict[str, dict],
    groups_by_id: dict[str, dict],
    *,
    depth: int = 0,
    max_depth: int = 4,
) -> list[dict]:
    groups: list[dict] = []
    for group_id in group_ids:
        group = groups_by_id.get(group_id)
        if not group:
            continue

        selection = group.get("selectionData") or {}
        min_choices = int(selection.get("minimumNumberOfChoices") or 0)
        max_choices = int(selection.get("maximumNumberOfChoices") or 0)
        options: list[dict] = []
        for item_id in group.get("itemIds") or []:
            option = lookup_item(item_id, items_by_id, modifier_items_by_id)
            if not option:
                continue
            option_record: dict = {
                "name": (option.get("name") or "").strip(),
                "price": round(item_price_value(option), 2),
            }
            nested_group_ids = option.get("modifier_group_ids") or []
            if depth < max_depth and nested_group_ids:
                nested = build_modifier_groups(
                    nested_group_ids,
                    items_by_id,
                    modifier_items_by_id,
                    groups_by_id,
                    depth=depth + 1,
                    max_depth=max_depth,
                )
                if nested:
                    option_record["nested"] = nested
            options.append(option_record)

        if options:
            groups.append(
                {
                    "name": (group.get("name") or "").strip(),
                    "minChoices": min_choices,
                    "maxChoices": max_choices,
                    "required": min_choices > 0,
                    "options": options,
                }
            )
    return groups


def load_store_menu_context() -> dict[str, dict]:
    menus_dir = DATA_DIR / "menus"
    context: dict[str, dict] = {}
    if not menus_dir.exists():
        return context

    for menu_path in menus_dir.glob("*.json"):
        menu = json.loads(menu_path.read_text())
        store_id = menu.get("store_id") or menu_path.stem
        items_by_id = {
            item["id"]: item
            for item in menu.get("items") or []
            if item.get("id")
        }
        modifier_items_by_id = menu.get("modifier_items") or {}
        groups_by_id = {
            group["id"]: group
            for group in menu.get("modifier_groups") or []
            if group.get("id")
        }
        context[store_id] = {
            "items_by_id": items_by_id,
            "modifier_items_by_id": modifier_items_by_id,
            "groups_by_id": groups_by_id,
        }
    return context


def enrich_item_pricing_and_modifiers(
    raw: dict,
    menu_context: dict[str, dict] | None,
) -> tuple[float | None, list[dict] | None]:
    store_id = raw.get("store_id")
    item_id = raw.get("id")
    if not store_id or not item_id or not menu_context:
        return raw.get("price"), None

    store_menu = menu_context.get(store_id)
    if not store_menu:
        return raw.get("price"), None

    items_by_id = store_menu["items_by_id"]
    modifier_items_by_id = store_menu["modifier_items_by_id"]
    groups_by_id = store_menu["groups_by_id"]
    item = items_by_id.get(item_id)
    if not item:
        return raw.get("price"), None

    cache: dict[str, float] = {}
    min_price = round(
        min_cost_for_item(
            item_id,
            items_by_id,
            modifier_items_by_id,
            groups_by_id,
            cache,
        ),
        2,
    )
    modifier_groups = build_modifier_groups(
        item.get("modifier_group_ids") or [],
        items_by_id,
        modifier_items_by_id,
        groups_by_id,
    )
    return min_price, modifier_groups or None


def load_store_lookup() -> dict[str, dict]:
    manifest = json.loads((DATA_DIR / "manifest.json").read_text())
    lookup: dict[str, dict] = {}
    for store in manifest.get("stores", []):
        store_id = store["store_id"]
        menu_path = DATA_DIR / "menus" / f"{store_id}.json"
        logo_url = None
        location_slug = store.get("location_slug")
        if menu_path.exists():
            menu_data = json.loads(menu_path.read_text())
            logo_url = menu_data.get("logo_url")
            location_slug = menu_data.get("location_slug") or location_slug
        lookup[store_id] = {
            "name": store.get("name") or store.get("brand_name") or store_id,
            "brand_slug": store.get("brand_slug"),
            "location_slug": location_slug,
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
    menu_context = load_store_menu_context()
    featured_lookup = load_featured_lookup()

    items = []
    modifiers: dict[str, list] = {}
    for raw in items_raw:
        store_id = raw.get("store_id")
        store = stores_by_id.get(store_id, {})
        store_name = store.get("name") or store_id or "Unknown"
        name = (raw.get("name") or "").strip()
        description = (raw.get("description") or "").strip()
        item_id = raw.get("id")
        special_rank = featured_lookup.get(item_id)
        min_price, modifier_groups = enrich_item_pricing_and_modifiers(raw, menu_context)
        record = {
            "id": item_id,
            "name": name,
            "description": description,
            "price": min_price,
            "storeId": store_id,
            "storeName": store_name,
            "storeLogo": store.get("logo_url"),
            "photoUrl": raw.get("photo_url"),
            "available": is_available(raw),
            "dietaryTags": parse_dietary_tags(name, description),
        }
        if special_rank is not None:
            record["special"] = True
            record["specialRank"] = special_rank
        store_url = build_store_url(
            store.get("brand_slug"),
            store.get("location_slug"),
            store_id,
        )
        if store_url:
            record["storeUrl"] = store_url
        item_url = build_item_url(
            store.get("brand_slug"),
            store.get("location_slug"),
            store_id,
            name,
            item_id,
        )
        if item_url:
            record["itemUrl"] = item_url
        if modifier_groups:
            record["hasModifiers"] = True
            modifiers[item_id] = modifier_groups
        items.append(record)

    stores = []
    for store_id, info in sorted(stores_by_id.items(), key=lambda row: row[1]["name"].lower()):
        store_record = {
            "id": store_id,
            "name": info["name"],
            "logoUrl": info.get("logo_url"),
        }
        store_url = build_store_url(
            info.get("brand_slug"),
            info.get("location_slug"),
            store_id,
        )
        if store_url:
            store_record["storeUrl"] = store_url
        stores.append(store_record)

    scraped_at = manifest.get("delivery_window_start")
    if scraped_at:
        try:
            dt = datetime.fromisoformat(scraped_at.replace("Z", "+00:00"))
            scraped_label = dt.astimezone(timezone.utc).strftime("%B %d, %Y")
        except ValueError:
            scraped_label = scraped_at
    else:
        scraped_label = datetime.now(timezone.utc).strftime("%B %d, %Y")

    payload = {
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
    return payload, modifiers


def main() -> None:
    payload, modifiers = build_index()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, separators=(",", ":")))
    if modifiers:
        MODIFIERS_OUTPUT_PATH.write_text(json.dumps(modifiers, separators=(",", ":")))

    featured_lookup = load_featured_lookup()
    if featured_lookup:
        seen_ids = {item["id"] for item in payload["items"]}
        missing = [item_id for item_id in featured_lookup if item_id not in seen_ids]
        matched = sum(1 for item in payload["items"] if item.get("special"))
        print(
            f"Featured items: {matched} matched, {len(missing)} missing from scrape",
        )
        for item_id in missing:
            print(f"  - missing featured id: {item_id}")

    modifier_note = f", {len(modifiers)} modifier sets" if modifiers else ""
    print(
        f"Wrote {OUTPUT_PATH} ({len(payload['items'])} items, {len(payload['stores'])} stores{modifier_note})",
    )


if __name__ == "__main__":
    main()
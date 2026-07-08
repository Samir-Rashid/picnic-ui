from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from picnic_scraper.client import PicnicGraphQLClient
from picnic_scraper.config import ScraperConfig
from picnic_scraper.queries import load_hubs_main_content_query, load_store_content_query


@dataclass(frozen=True)
class StoreRef:
    store_id: str
    name: str
    brand_name: str | None = None
    brand_slug: str | None = None
    location_slug: str | None = None
    logo_url: str | None = None
    facility_id: str | None = None


def money_to_float(money: dict[str, Any] | None) -> float | None:
    if not money:
        return None
    units = int(money.get("units") or 0)
    nanos = int(money.get("nanos") or 0)
    return units + nanos / 1_000_000_000


def build_hubs_main_content_input(config: ScraperConfig) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "hubOrderConstraint": config.hub_order_constraint.to_graphql(),
        "serviceSlug": config.service_slug,
        "filters": config.filters
        or {"tags": ["TAG_ALL"], "removeItemModifiers": True},
    }
    if config.facility_id:
        payload["cartConstraints"] = {"facilityId": config.facility_id}
    return payload


def collect_category_item_ids(categories: list[dict[str, Any]]) -> set[str]:
    item_ids: set[str] = set()
    for category in categories:
        for item_id in category.get("itemIds") or []:
            item_ids.add(item_id)
    return item_ids


def collect_modifier_item_ids(modifier_groups: list[dict[str, Any]]) -> set[str]:
    item_ids: set[str] = set()
    for group in modifier_groups:
        for item_id in group.get("itemIds") or []:
            item_ids.add(item_id)
    return item_ids


def filter_orderable_items(
    items: list[dict[str, Any]],
    categories: list[dict[str, Any]],
    modifier_groups: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Keep category menu items; drop modifier-only options from the flat item map."""
    category_item_ids = collect_category_item_ids(categories)
    modifier_item_ids = collect_modifier_item_ids(modifier_groups)

    filtered: list[dict[str, Any]] = []
    for item in items:
        item_id = item.get("id")
        if not item_id:
            continue
        if item_id in category_item_ids:
            filtered.append(item)
        elif not category_item_ids and item_id not in modifier_item_ids:
            # Some stores return items without category metadata.
            filtered.append(item)
    return filtered


def normalize_item(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item.get("id"),
        "store_id": item.get("storeId"),
        "name": item.get("name"),
        "description": item.get("description"),
        "price": money_to_float(
            (item.get("priceData") or {}).get("displayPrice")
            or (item.get("priceData") or {}).get("price")
        ),
        "modifier_group_ids": item.get("modifierGroupIds") or [],
        "photo_url": (item.get("photo") or {}).get("photoUrl"),
        "is_alcoholic": (item.get("contents") or {}).get("isAlcoholic"),
        "item_status": item.get("itemStatus"),
        "is_suspended": item.get("isSuspended"),
        "dietary_restrictions": item.get("dietaryRestrictions") or [],
        "allergens": item.get("allergens") or [],
    }


def build_modifier_items(
    items: list[dict[str, Any]],
    modifier_groups: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    modifier_item_ids = collect_modifier_item_ids(modifier_groups)
    return {
        item["id"]: item
        for item in items
        if item.get("id") in modifier_item_ids
    }


def extract_menu_from_dqs_menu(menu: dict[str, Any]) -> dict[str, Any]:
    items = [
        normalize_item(item_entry.get("value") or {})
        for item_entry in menu.get("items") or []
        if item_entry.get("value")
    ]
    categories = [
        entry.get("value")
        for entry in menu.get("categories") or []
        if entry.get("value")
    ]
    modifier_groups = [
        entry.get("value")
        for entry in menu.get("modifierGroups") or []
        if entry.get("value")
    ]
    modifier_items = build_modifier_items(items, modifier_groups)
    items = filter_orderable_items(items, categories, modifier_groups)
    items.sort(key=lambda row: (row.get("name") or "").lower())
    return {
        "menu_infos": menu.get("menuInfos") or [],
        "categories": categories,
        "modifier_groups": modifier_groups,
        "modifier_items": modifier_items,
        "items": items,
    }


def extract_stores_from_hubs_main_content(data: dict[str, Any]) -> list[StoreRef]:
    stores: dict[str, StoreRef] = {}
    layout = data.get("hubsMainContent", {}).get("taggedLayout") or {}

    for entry in layout.get("storeTiles") or []:
        store = entry.get("value") or {}
        store_id = store.get("storeId")
        if not store_id:
            continue
        stores[store_id] = StoreRef(
            store_id=store_id,
            name=store.get("brandName") or store_id,
            brand_name=store.get("brandName"),
            brand_slug=store.get("brandSlug"),
            location_slug=store.get("locationSlug"),
            logo_url=store.get("storeLogoUrl"),
            facility_id=store.get("facilityId"),
        )

    return list(stores.values())


def extract_menus_from_hubs_main_content(data: dict[str, Any]) -> dict[str, dict[str, Any]]:
    menus_by_store: dict[str, dict[str, Any]] = {}
    layout = data.get("hubsMainContent", {}).get("taggedLayout") or {}

    for entry in layout.get("menus") or []:
        store_id = str(entry.get("key"))
        menu = entry.get("value") or {}
        if not store_id:
            continue

        parsed = extract_menu_from_dqs_menu(menu)
        menus_by_store[store_id] = {
            "store_id": store_id,
            **parsed,
            "source": "HubsMainContent.featured",
        }

    return menus_by_store


def fetch_hubs_main_content(
    client: PicnicGraphQLClient,
    config: ScraperConfig,
    repo_root: Path,
) -> dict[str, Any]:
    return client.execute(
        "HubsMainContent",
        load_hubs_main_content_query(repo_root),
        {"hubsMainContentInput": build_hubs_main_content_input(config)},
    )


def fetch_store_list(
    client: PicnicGraphQLClient,
    config: ScraperConfig,
    repo_root: Path,
) -> list[StoreRef]:
    data = fetch_hubs_main_content(client, config, repo_root)
    return extract_stores_from_hubs_main_content(data)


def build_store_content_variables(
    config: ScraperConfig,
    store: StoreRef,
) -> dict[str, Any]:
    defaults = config.store_content or {}
    facility_id = store.facility_id or defaults.get("facilityId")
    if not facility_id:
        raise ValueError(
            f"No facilityId for store {store.name!r}. "
            "Capture a storeContent curl or ensure HubsMainContent returns facilityId."
        )

    return {
        "storeConstraints": {
            "storeId": store.store_id,
            "facilityConstraints": {
                "facilityId": facility_id,
                "customerInteractionSource": defaults.get(
                    "customerInteractionSource",
                    "CUSTOMER_INTERACTION_SOURCE_EATER_APP",
                ),
                "serviceSlug": defaults.get("serviceSlug") or config.service_slug,
                "fulfillmentMode": defaults.get(
                    "fulfillmentMode",
                    "FULFILLMENT_MODE_RESTAURANT_DELIVERY",
                ),
                "orderConstraint": {
                    "hubOrderConstraint": config.hub_order_constraint.to_graphql(),
                },
            },
        },
    }


def fetch_store_content(
    client: PicnicGraphQLClient,
    config: ScraperConfig,
    store: StoreRef,
    repo_root: Path,
) -> dict[str, Any]:
    return client.execute(
        "storeContent",
        load_store_content_query(repo_root),
        build_store_content_variables(config, store),
    )


def extract_menu_from_store_content(data: dict[str, Any]) -> dict[str, Any]:
    store_content = data.get("storeContent") or {}
    menu = store_content.get("menu") or {}
    parsed = extract_menu_from_dqs_menu(menu)
    return {
        "store_id": store_content.get("storeId"),
        "brand_name": store_content.get("brandName"),
        "brand_slug": store_content.get("brandSlug"),
        "location_slug": store_content.get("locationSlug"),
        "logo_url": store_content.get("storeLogoUrl"),
        **parsed,
    }


def group_items_by_store(items: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for item in items:
        store_id = item.get("store_id")
        if not store_id:
            continue
        grouped.setdefault(store_id, []).append(item)
    for store_items in grouped.values():
        store_items.sort(key=lambda row: (row.get("name") or "").lower())
    return grouped


def enrich_saved_menus_with_modifier_items(output_dir: Path) -> int:
    """Attach modifier option lookup tables to saved per-store menus."""
    all_items_path = output_dir / "all_items.json"
    menus_dir = output_dir / "menus"
    if not all_items_path.exists() or not menus_dir.exists():
        return 0

    scraped = json.loads(all_items_path.read_text())
    menus_by_store = {menu["store_id"]: menu for menu in scraped}
    enriched = 0

    for menu_path in menus_dir.glob("*.json"):
        menu = json.loads(menu_path.read_text())
        store_id = menu.get("store_id") or menu_path.stem
        full_menu = menus_by_store.get(store_id)
        if not full_menu:
            continue
        full_items = {
            item["id"]: item
            for item in full_menu.get("items") or []
            if item.get("id")
        }
        menu["modifier_items"] = build_modifier_items(
            list(full_items.values()),
            menu.get("modifier_groups") or [],
        )
        menu_path.write_text(json.dumps(menu, indent=2))
        enriched += 1

    return enriched


def refilter_saved_menus(output_dir: Path) -> dict[str, Any]:
    """Re-apply orderable-item filtering to previously scraped menu files."""
    menus_dir = output_dir / "menus"
    manifest_path = output_dir / "manifest.json"
    if not menus_dir.exists():
        raise FileNotFoundError(f"Missing {menus_dir}")

    all_items_by_id: dict[str, dict[str, Any]] = {}
    item_counts: dict[str, int] = {}
    menus_by_store: dict[str, dict[str, Any]] = {}
    all_items_path = output_dir / "all_items.json"
    if all_items_path.exists():
        menus_by_store = {
            menu["store_id"]: menu
            for menu in json.loads(all_items_path.read_text())
        }

    for menu_path in sorted(menus_dir.glob("*.json")):
        menu = json.loads(menu_path.read_text())
        store_id = menu.get("store_id") or menu_path.stem
        categories = menu.get("categories") or []
        modifier_groups = menu.get("modifier_groups") or []
        items = menu.get("items") or []
        filtered_items = filter_orderable_items(items, categories, modifier_groups)
        menu["items"] = filtered_items
        if full_menu := menus_by_store.get(store_id):
            full_items = {
                item["id"]: item
                for item in full_menu.get("items") or []
                if item.get("id")
            }
            menu["modifier_items"] = build_modifier_items(
                list(full_items.values()),
                modifier_groups,
            )
        menu_path.write_text(json.dumps(menu, indent=2))
        item_counts[store_id] = len(filtered_items)
        for item in filtered_items:
            item_id = item.get("id")
            if item_id:
                all_items_by_id[item_id] = item

    all_items = list(all_items_by_id.values())
    manifest = {}
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
    manifest["total_items"] = len(all_items)
    for store in manifest.get("stores") or []:
        store["item_count"] = item_counts.get(store["store_id"], 0)

    with (output_dir / "all_items_flat.json").open("w") as handle:
        json.dump(all_items, handle, indent=2)
    with manifest_path.open("w") as handle:
        json.dump(manifest, handle, indent=2)

    return {
        "item_count": len(all_items),
        "store_count": len(item_counts),
    }


def scrape_all_menus(
    config: ScraperConfig,
    output_dir: Path,
    *,
    repo_root: Path | None = None,
) -> dict[str, Any]:
    root = repo_root or Path.cwd()
    output_dir.mkdir(parents=True, exist_ok=True)
    load_store_content_query(root)

    with PicnicGraphQLClient(config) as client:
        hubs_data = fetch_hubs_main_content(client, config, root)
        stores = extract_stores_from_hubs_main_content(hubs_data)
        featured_menus = extract_menus_from_hubs_main_content(hubs_data)

        if not stores:
            raise RuntimeError(
                "No stores returned from HubsMainContent. "
                "Check hubId/routeId, delivery window, and cookies in config.json."
            )

        menus_dir = output_dir / "menus"
        menus_dir.mkdir(exist_ok=True)

        scraped_menus: list[dict[str, Any]] = []
        all_items_by_id: dict[str, dict[str, Any]] = {}

        for index, store in enumerate(stores, start=1):
            featured = featured_menus.get(store.store_id, {})
            featured_items = featured.get("items") or []

            data = fetch_store_content(client, config, store, root)
            menu_data = extract_menu_from_store_content(data)
            items = menu_data.get("items") or []

            for item in items:
                item_id = item.get("id")
                if item_id:
                    all_items_by_id[item_id] = item

            menu = {
                "store_id": store.store_id,
                "store_name": menu_data.get("brand_name") or store.name,
                "brand_name": menu_data.get("brand_name") or store.brand_name,
                "brand_slug": menu_data.get("brand_slug") or store.brand_slug,
                "location_slug": menu_data.get("location_slug") or store.location_slug,
                "logo_url": menu_data.get("logo_url") or store.logo_url,
                "menu_infos": menu_data.get("menu_infos") or [],
                "categories": menu_data.get("categories") or [],
                "modifier_groups": menu_data.get("modifier_groups") or [],
                "modifier_items": menu_data.get("modifier_items") or {},
                "featured_items": featured_items,
                "items": items,
                "source": "storeContent",
            }
            scraped_menus.append(menu)

            store_path = menus_dir / f"{store.store_id}.json"
            with store_path.open("w") as handle:
                json.dump(menu, handle, indent=2)

            print(
                f"[{index}/{len(stores)}] {store.name} "
                f"({store.store_id}) — {len(items)} items"
            )

        all_items = list(all_items_by_id.values())
        item_counts = {
            menu["store_id"]: len(menu.get("items") or []) for menu in scraped_menus
        }
        manifest = {
            "hub_id": config.hub_order_constraint.hub_id,
            "route_id": config.hub_order_constraint.route_id,
            "delivery_window_start": config.hub_order_constraint.delivery_window_start,
            "delivery_window_end": config.hub_order_constraint.delivery_window_end,
            "service_slug": config.service_slug,
            "store_count": len(stores),
            "total_items": len(all_items),
            "scrape_source": "storeContent",
            "stores": [
                {
                    "store_id": store.store_id,
                    "name": store.name,
                    "brand_name": store.brand_name,
                    "brand_slug": store.brand_slug,
                    "location_slug": store.location_slug,
                    "item_count": item_counts.get(store.store_id, 0),
                    "featured_item_count": len(
                        (featured_menus.get(store.store_id) or {}).get("items") or []
                    ),
                }
                for index, store in enumerate(stores)
            ],
        }

        with (output_dir / "hubs_main_content.json").open("w") as handle:
            json.dump(hubs_data, handle, indent=2)

        with (output_dir / "all_items_flat.json").open("w") as handle:
            json.dump(all_items, handle, indent=2)

        with (output_dir / "manifest.json").open("w") as handle:
            json.dump(manifest, handle, indent=2)

        with (output_dir / "all_items.json").open("w") as handle:
            json.dump(scraped_menus, handle, indent=2)

        return manifest
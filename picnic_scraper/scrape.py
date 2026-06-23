from __future__ import annotations

import json
import string
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from picnic_scraper.client import PicnicGraphQLClient
from picnic_scraper.config import ScraperConfig
from picnic_scraper.queries import SEARCH_ITEMS_AND_STORES, load_hubs_main_content_query


@dataclass(frozen=True)
class StoreRef:
    store_id: str
    name: str
    brand_name: str | None = None
    brand_slug: str | None = None
    location_slug: str | None = None
    logo_url: str | None = None


SEARCH_QUERIES = ("*",) + tuple(string.ascii_lowercase)


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

        menus_by_store[store_id] = {
            "store_id": store_id,
            "menu_infos": menu.get("menuInfos") or [],
            "categories": categories,
            "modifier_groups": modifier_groups,
            "items": items,
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


def search_items(
    client: PicnicGraphQLClient,
    config: ScraperConfig,
    query_text: str,
) -> dict[str, Any]:
    variables = {
        "input": {
            "hubOrderConstraint": config.hub_order_constraint.to_graphql(),
            "serviceSlug": config.service_slug,
            "query": query_text,
        }
    }
    return client.execute(
        "SearchItemsAndStoresForHub",
        SEARCH_ITEMS_AND_STORES,
        variables,
    )


def search_all_items(client: PicnicGraphQLClient, config: ScraperConfig) -> list[dict[str, Any]]:
    items_by_id: dict[str, dict[str, Any]] = {}

    for query_text in SEARCH_QUERIES:
        data = search_items(client, config, query_text)
        items = ((data.get("searchItemsAndStoresForHub") or {}).get("items") or [])
        for item in items:
            item_id = item.get("id")
            if item_id:
                items_by_id[item_id] = normalize_item(item)
        print(f"search {query_text!r}: {len(items)} hits, {len(items_by_id)} unique items")

    return list(items_by_id.values())


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


def scrape_all_menus(
    config: ScraperConfig,
    output_dir: Path,
    *,
    repo_root: Path | None = None,
) -> dict[str, Any]:
    root = repo_root or Path.cwd()
    output_dir.mkdir(parents=True, exist_ok=True)

    with PicnicGraphQLClient(config) as client:
        hubs_data = fetch_hubs_main_content(client, config, root)
        stores = extract_stores_from_hubs_main_content(hubs_data)
        featured_menus = extract_menus_from_hubs_main_content(hubs_data)

        if not stores:
            raise RuntimeError(
                "No stores returned from HubsMainContent. "
                "Check hubId/routeId, delivery window, and cookies in config.json."
            )

        all_items = search_all_items(client, config)
        items_by_store = group_items_by_store(all_items)

        menus_dir = output_dir / "menus"
        menus_dir.mkdir(exist_ok=True)

        scraped_menus: list[dict[str, Any]] = []
        for index, store in enumerate(stores, start=1):
            featured = featured_menus.get(store.store_id, {})
            menu = {
                "store_id": store.store_id,
                "store_name": store.name,
                "brand_name": store.brand_name,
                "brand_slug": store.brand_slug,
                "location_slug": store.location_slug,
                "logo_url": store.logo_url,
                "menu_infos": featured.get("menu_infos") or [],
                "categories": featured.get("categories") or [],
                "modifier_groups": featured.get("modifier_groups") or [],
                "featured_items": featured.get("items") or [],
                "items": items_by_store.get(store.store_id, []),
                "source": "SearchItemsAndStoresForHub",
            }
            scraped_menus.append(menu)

            store_path = menus_dir / f"{store.store_id}.json"
            with store_path.open("w") as handle:
                json.dump(menu, handle, indent=2)

            print(
                f"[{index}/{len(stores)}] {store.name} "
                f"({store.store_id}) — {len(menu['items'])} items"
            )

        manifest = {
            "hub_id": config.hub_order_constraint.hub_id,
            "route_id": config.hub_order_constraint.route_id,
            "delivery_window_start": config.hub_order_constraint.delivery_window_start,
            "delivery_window_end": config.hub_order_constraint.delivery_window_end,
            "service_slug": config.service_slug,
            "store_count": len(stores),
            "total_items": len(all_items),
            "search_queries": list(SEARCH_QUERIES),
            "stores": [
                {
                    "store_id": store.store_id,
                    "name": store.name,
                    "brand_name": store.brand_name,
                    "brand_slug": store.brand_slug,
                    "location_slug": store.location_slug,
                    "item_count": len(items_by_store.get(store.store_id, [])),
                    "featured_item_count": len(
                        (featured_menus.get(store.store_id) or {}).get("items") or []
                    ),
                }
                for store in stores
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
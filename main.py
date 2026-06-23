from __future__ import annotations

import argparse
import json
from pathlib import Path

from picnic_scraper.capture import write_config_from_curl
from picnic_scraper.client import PicnicGraphQLClient
from picnic_scraper.config import ScraperConfig
from picnic_scraper.scrape import (
    extract_menus_from_hubs_main_content,
    extract_stores_from_hubs_main_content,
    fetch_hubs_main_content,
    scrape_all_menus,
)


def cmd_probe(config_path: Path) -> int:
    config = ScraperConfig.load(config_path)
    repo_root = config_path.parent
    with PicnicGraphQLClient(config) as client:
        data = fetch_hubs_main_content(client, config, repo_root)

    stores = extract_stores_from_hubs_main_content(data)
    menus = extract_menus_from_hubs_main_content(data)
    preview = {
        "store_count": len(stores),
        "featured_menu_count": len(menus),
        "featured_items": sum(len(menu.get("items") or []) for menu in menus.values()),
        "stores": [
            {
                "store_id": store.store_id,
                "name": store.name,
                "featured_item_count": len(
                    (menus.get(store.store_id) or {}).get("items") or []
                ),
            }
            for store in stores[:10]
        ],
    }
    print(json.dumps(preview, indent=2))
    if not stores:
        print(
            "\nNo stores returned. Cookies may be expired, or hub/route/window may be wrong."
        )
        return 1
    return 0


def cmd_capture(curl_path: Path, output_path: Path) -> int:
    config = write_config_from_curl(curl_path, output_path)
    print(f"Wrote {output_path}")
    if (output_path.parent / "captured_hubs_main_content.graphql").exists():
        print("Wrote captured_hubs_main_content.graphql")
    print(
        json.dumps(
            {
                "api_url": config["api_url"],
                "hub_id": config["hub_order_constraint"]["hubId"],
                "route_id": config["hub_order_constraint"]["routeId"],
                "delivery_window_start": config["hub_order_constraint"].get(
                    "deliveryWindowStart"
                ),
                "delivery_window_end": config["hub_order_constraint"].get(
                    "deliveryWindowEnd"
                ),
                "service_slug": config["service_slug"],
                "cookie_length": len(config["cookies"]),
            },
            indent=2,
        )
    )
    return 0


def cmd_scrape(config_path: Path, output_dir: Path) -> int:
    config = ScraperConfig.load(config_path)
    manifest = scrape_all_menus(
        config,
        output_dir,
        repo_root=config_path.parent,
    )
    print(json.dumps(manifest, indent=2))
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Scrape Picnic office lunch menus")
    subparsers = parser.add_subparsers(dest="command", required=True)

    capture_parser = subparsers.add_parser(
        "capture",
        help="Build config.json from a copied curl command",
    )
    capture_parser.add_argument(
        "curl_file",
        type=Path,
        help="Path to a file containing a curl command copied from DevTools",
    )
    capture_parser.add_argument(
        "--output",
        type=Path,
        default=Path("config.json"),
        help="Where to write config.json",
    )

    probe_parser = subparsers.add_parser(
        "probe",
        help="Test auth + hub context by listing stores",
    )
    probe_parser.add_argument(
        "--config",
        type=Path,
        default=Path("config.json"),
        help="Path to config.json",
    )

    scrape_parser = subparsers.add_parser(
        "scrape",
        help="Scrape all store menus to data/",
    )
    scrape_parser.add_argument(
        "--config",
        type=Path,
        default=Path("config.json"),
        help="Path to config.json",
    )
    scrape_parser.add_argument(
        "--output",
        type=Path,
        default=Path("data"),
        help="Output directory",
    )

    args = parser.parse_args()
    if args.command == "capture":
        raise SystemExit(cmd_capture(args.curl_file, args.output))
    if args.command == "probe":
        raise SystemExit(cmd_probe(args.config))
    if args.command == "scrape":
        raise SystemExit(cmd_scrape(args.config, args.output))


if __name__ == "__main__":
    main()
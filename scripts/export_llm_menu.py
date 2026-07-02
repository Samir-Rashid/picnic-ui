#!/usr/bin/env python3
"""Generate a plain-text Picnic menu export for LLM use (on demand, not committed)."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MENU_PATH = ROOT / "web" / "public" / "menu.json"
DEFAULT_OUT = ROOT / "web" / "public" / "menu-for-llm.txt"


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def format_price(price: float | None) -> str:
    if price is None:
        return "—"
    return f"${round(price)}"


def format_tags(item: dict) -> str:
    tags: list[str] = []
    if item.get("special"):
        tags.append("special")
    tags.extend(item.get("dietaryTags") or [])
    return ", ".join(tags) if tags else "none"


def format_item_block(item: dict) -> str:
    lines = [
        f"### {item['name']} — {format_price(item.get('price'))}",
        f"Tags: {format_tags(item)}",
    ]
    description = clean_text(item.get("description", ""))
    if description:
        lines.append(f"Description: {description}")
    return "\n".join(lines)


def format_menu_for_llm(data: dict) -> str:
    meta = data["meta"]
    available = [item for item in data["items"] if item.get("available")]
    items_by_store: dict[str, list[dict]] = {}
    for item in available:
        items_by_store.setdefault(item["storeName"], []).append(item)

    header = "\n".join(
        [
            "PICNIC OFFICE LUNCH MENU (text export)",
            f"Snapshot: {meta['scrapedAt']}",
            f"Restaurants: {len(items_by_store)}",
            f"Items: {len(available)}",
            "",
            "Fields per item: name, price, tags, description.",
            "Tags are auto-detected hints and may be incomplete.",
            "",
            "---",
            "",
        ]
    )

    sections: list[str] = []
    for store_name in sorted(items_by_store):
        items = sorted(items_by_store[store_name], key=lambda row: row["name"].lower())
        blocks = "\n\n".join(format_item_block(item) for item in items)
        sections.append(f"## {store_name}\n\n{blocks}")

    return f"{header}{chr(10).join(sections)}\n"


def main() -> None:
    menu_path = Path(sys.argv[1]) if len(sys.argv) > 1 else MENU_PATH
    out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_OUT

    if not menu_path.exists():
        raise FileNotFoundError(f"Missing {menu_path}. Run: uv run python scripts/build_search_index.py")

    data = json.loads(menu_path.read_text())
    available = [item for item in data["items"] if item.get("available")]
    text = format_menu_for_llm(data)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(text)
    print(f"Wrote {out_path} ({len(text):,} chars, {len(available)} available items)")


if __name__ == "__main__":
    main()
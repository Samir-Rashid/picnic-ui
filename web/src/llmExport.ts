import { formatPrice } from "./search";
import type { MenuData, MenuItem } from "./types";

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function formatTags(item: MenuItem): string {
  const tags: string[] = [];
  if (item.special) {
    tags.push("special");
  }
  tags.push(...item.dietaryTags);
  return tags.length > 0 ? tags.join(", ") : "none";
}

function formatItemBlock(item: MenuItem): string {
  const lines = [
    `### ${item.name} — ${formatPrice(item.price)}`,
    `Status: ${item.available ? "available" : "unavailable"}`,
    `Tags: ${formatTags(item)}`,
  ];
  const description = cleanText(item.description);
  if (description) {
    lines.push(`Description: ${description}`);
  }
  return lines.join("\n");
}

/**
 * Plain-text menu export for pasting into an LLM.
 * Keeps only fields useful for lunch Q&A: restaurant, dish name, price,
 * availability, dietary hints, and description.
 */
export function formatMenuForLlm(data: MenuData): string {
  const itemsByStore = new Map<string, MenuItem[]>();
  for (const item of data.items) {
    const bucket = itemsByStore.get(item.storeName) ?? [];
    bucket.push(item);
    itemsByStore.set(item.storeName, bucket);
  }

  const header = [
    "PICNIC OFFICE LUNCH MENU (text export)",
    `Snapshot: ${data.meta.scrapedAt}`,
    `Restaurants: ${data.meta.storeCount}`,
    `Items: ${data.meta.itemCount} total, ${data.meta.availableCount} available`,
    "",
    "Fields per item: name, price, availability, tags, description.",
    "Tags are auto-detected hints and may be incomplete.",
    "",
    "---",
    "",
  ].join("\n");

  const storeSections = [...itemsByStore.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([storeName, items]) => {
      const sortedItems = [...items].sort((a, b) => a.name.localeCompare(b.name));
      const blocks = sortedItems.map((item) => formatItemBlock(item)).join("\n\n");
      return `## ${storeName}\n\n${blocks}`;
    });

  return `${header}${storeSections.join("\n\n")}\n`;
}

export function openLlmExport(data: MenuData): void {
  const text = formatMenuForLlm(data);
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "picnic-menu-for-llm.txt";
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
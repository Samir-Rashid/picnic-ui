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
    `Tags: ${formatTags(item)}`,
  ];
  const description = cleanText(item.description);
  if (description) {
    lines.push(`Description: ${description}`);
  }
  return lines.join("\n");
}

function availableItems(data: MenuData): MenuItem[] {
  return data.items.filter((item) => item.available);
}

/**
 * Plain-text menu export for pasting into an LLM.
 * Includes only available items — fields: name, price, tags, description.
 */
export function formatMenuForLlm(data: MenuData): string {
  const items = availableItems(data);
  const itemsByStore = new Map<string, MenuItem[]>();

  for (const item of items) {
    const bucket = itemsByStore.get(item.storeName) ?? [];
    bucket.push(item);
    itemsByStore.set(item.storeName, bucket);
  }

  const header = [
    "PICNIC OFFICE LUNCH MENU (text export)",
    `Snapshot: ${data.meta.scrapedAt}`,
    `Restaurants: ${itemsByStore.size}`,
    `Items: ${items.length}`,
    "",
    "Fields per item: name, price, tags, description.",
    "Tags are auto-detected hints and may be incomplete.",
    "",
    "---",
    "",
  ].join("\n");

  const storeSections = [...itemsByStore.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([storeName, storeItems]) => {
      const sortedItems = [...storeItems].sort((a, b) => a.name.localeCompare(b.name));
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
export interface KeyboardShortcut {
  keys: string[];
  label: string;
}

export const KEYBOARD_SHORTCUTS: KeyboardShortcut[] = [
  { keys: ["/"], label: "Focus search" },
  { keys: ["j", "↓"], label: "Next item" },
  { keys: ["k", "↑"], label: "Previous item" },
  { keys: ["g"], label: "First item" },
  { keys: ["G"], label: "Last item" },
  { keys: ["Enter", "Space"], label: "Toggle item details" },
  { keys: ["o"], label: "Open item on Picnic" },
  { keys: ["f"], label: "Toggle filters" },
  { keys: ["Esc"], label: "Back out / clear" },
  { keys: ["?"], label: "Show all shortcuts" },
];

export function renderShortcutKeys(keys: string[]): string {
  return keys
    .map((key) => `<kbd>${escapeHtml(key)}</kbd>`)
    .join('<span class="shortcut-sep"> or </span>');
}

export function renderKeyboardHelpPanel(): string {
  const rows = KEYBOARD_SHORTCUTS.map(
    ({ keys, label }) => `
      <div class="keyboard-help-item">
        <dt>${escapeHtml(label)}</dt>
        <dd>${renderShortcutKeys(keys)}</dd>
      </div>
    `,
  ).join("");

  return `
    <aside id="keyboardHelp" class="keyboard-help" hidden>
      <div class="keyboard-help-panel" role="dialog" aria-label="Keyboard shortcuts">
        <dl class="keyboard-help-list">${rows}</dl>
      </div>
    </aside>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function isTypingInField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export function getResultRows(resultsEl: HTMLElement): HTMLElement[] {
  return [...resultsEl.querySelectorAll<HTMLElement>(".item-row")];
}

export function syncRowFocus(
  resultsEl: HTMLElement,
  focusedItemId: string | null,
  options: { scroll?: boolean } = {},
): void {
  const rows = getResultRows(resultsEl);
  const focusedRow = focusedItemId
    ? rows.find((row) => row.dataset.itemId === focusedItemId) ?? null
    : null;

  rows.forEach((row) => {
    const isFocused = row === focusedRow;
    row.classList.toggle("is-focused", isFocused);
    row.tabIndex = isFocused ? 0 : -1;
  });

  if (focusedRow) {
    focusedRow.focus({ preventScroll: true });
    if (options.scroll) {
      focusedRow.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }
}

export function moveFocus(
  resultsEl: HTMLElement,
  focusedItemId: string | null,
  delta: 1 | -1,
): string | null {
  const rows = getResultRows(resultsEl);
  if (rows.length === 0) {
    return null;
  }

  let index = focusedItemId
    ? rows.findIndex((row) => row.dataset.itemId === focusedItemId)
    : -1;

  if (index === -1) {
    index = delta === 1 ? 0 : rows.length - 1;
  } else {
    index = Math.max(0, Math.min(rows.length - 1, index + delta));
  }

  return rows[index]?.dataset.itemId ?? null;
}

export function focusBoundary(resultsEl: HTMLElement, position: "first" | "last"): string | null {
  const rows = getResultRows(resultsEl);
  if (rows.length === 0) {
    return null;
  }
  const row = position === "first" ? rows[0] : rows[rows.length - 1];
  return row.dataset.itemId ?? null;
}
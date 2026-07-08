import type { MenuItem, ModifierGroup, ScoredItem } from "./types";

const INITIAL_COUNT = 120;
const LOAD_MORE_COUNT = 80;
const ENSURE_BUFFER = 16;

export type RenderItemRowFn = (
  item: MenuItem,
  expanded: boolean,
  focused: boolean,
  modifierGroups?: ModifierGroup[],
) => string;

export interface ResultsMountOptions {
  expandedItemId: string | null;
  focusedItemId: string | null;
  getModifiers: (itemId: string) => ModifierGroup[] | undefined;
}

export class ResultsList {
  private renderedCount = INITIAL_COUNT;
  private results: ScoredItem[] = [];
  private observer: IntersectionObserver | null = null;
  private sentinel: HTMLElement | null = null;

  constructor(private readonly resultsEl: HTMLElement) {}

  reset(): void {
    this.renderedCount = INITIAL_COUNT;
    this.disconnectObserver();
    this.sentinel = null;
  }

  getRenderedCount(): number {
    return this.renderedCount;
  }

  ensureItemVisible(itemId: string): boolean {
    const index = this.results.findIndex(({ item }) => item.id === itemId);
    if (index === -1) {
      return false;
    }
    const needed = index + ENSURE_BUFFER + 1;
    if (needed <= this.renderedCount) {
      return false;
    }
    this.renderedCount = Math.min(this.results.length, needed);
    return true;
  }

  revealAll(): boolean {
    if (this.renderedCount >= this.results.length) {
      return false;
    }
    this.renderedCount = this.results.length;
    return true;
  }

  mount(
    results: ScoredItem[],
    renderRow: RenderItemRowFn,
    options: ResultsMountOptions,
  ): void {
    this.results = results;
    this.renderedCount = Math.min(this.renderedCount, results.length);
    this.disconnectObserver();
    this.sentinel = null;
    this.renderSlice(0, this.renderedCount, renderRow, options, true);
    this.attachSentinel();
  }

  loadMore(renderRow: RenderItemRowFn, options: ResultsMountOptions): void {
    if (this.renderedCount >= this.results.length) {
      return;
    }
    this.disconnectObserver();
    const from = this.renderedCount;
    this.renderedCount = Math.min(this.results.length, this.renderedCount + LOAD_MORE_COUNT);
    this.renderSlice(from, this.renderedCount, renderRow, options, false);
    if (this.renderedCount >= this.results.length) {
      this.sentinel?.remove();
      this.sentinel = null;
      return;
    }
    this.observeSentinel();
  }

  private renderSlice(
    from: number,
    to: number,
    renderRow: RenderItemRowFn,
    options: ResultsMountOptions,
    replace: boolean,
  ): void {
    const html = this.results
      .slice(from, to)
      .map(({ item }) =>
        renderRow(
          item,
          options.expandedItemId === item.id,
          options.focusedItemId === item.id,
          options.expandedItemId === item.id ? options.getModifiers(item.id) : undefined,
        ),
      )
      .join("");

    if (replace) {
      this.resultsEl.innerHTML = html;
      return;
    }

    if (this.sentinel) {
      this.sentinel.insertAdjacentHTML("beforebegin", html);
      return;
    }

    this.resultsEl.insertAdjacentHTML("beforeend", html);
  }

  private attachSentinel(): void {
    if (this.renderedCount >= this.results.length) {
      return;
    }

    const sentinel = document.createElement("div");
    sentinel.className = "results-sentinel";
    sentinel.setAttribute("aria-hidden", "true");
    this.resultsEl.appendChild(sentinel);
    this.sentinel = sentinel;
    this.observeSentinel();
  }

  private observeSentinel(): void {
    if (!this.sentinel) {
      return;
    }
    this.disconnectObserver();
    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          this.disconnectObserver();
          document.dispatchEvent(new CustomEvent("results:load-more"));
        }
      },
      { rootMargin: "600px 0px" },
    );
    this.observer.observe(this.sentinel);
  }

  private disconnectObserver(): void {
    this.observer?.disconnect();
    this.observer = null;
  }
}
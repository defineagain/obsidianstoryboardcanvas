// ═══════════════════════════════════════
// LAYOUT ENGINE — X/Y coordinate calculator
// ═══════════════════════════════════════
// X = f(date ordinal), Y = f(arc index)

import type { AbstractDate, LayoutConfig, StoryEvent } from './canvasTypes';
import { DEFAULT_LAYOUT_CONFIG } from './canvasTypes';
import type { Position } from './Canvas';

// ─── Date Comparison ─────────────────────────────────────────

/**
 * Compare two AbstractDates lexicographically.
 * Returns negative if a < b, positive if a > b, 0 if equal.
 */
export function compareAbstractDates(a: AbstractDate, b: AbstractDate): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

/**
 * Flatten an AbstractDate into a single sortable ordinal number.
 * Uses weighted positional encoding: each segment is multiplied by
 * a decreasing power of a large base (10000) to preserve ordering.
 *
 * For [year, month, day]: year * 10000^2 + month * 10000 + day
 */
export function dateToOrdinal(date: AbstractDate): number {
  const BASE = 10000;
  let ordinal = 0;
  for (let i = 0; i < date.length; i++) {
    ordinal += date[i] * Math.pow(BASE, date.length - 1 - i);
  }
  return ordinal;
}

// ─── Timeline Extent ─────────────────────────────────────────

/**
 * Calculate the min/max date extent across all events.
 */
export function calculateTimelineExtent(
  events: StoryEvent[],
): { min: AbstractDate; max: AbstractDate } | null {
  if (events.length === 0) return null;

  let min = events[0].date;
  let max = events[0].date;

  for (const event of events) {
    if (compareAbstractDates(event.date, min) < 0) min = event.date;
    const end = event.endDate ?? event.date;
    if (compareAbstractDates(end, max) > 0) max = end;
  }

  return { min, max };
}

// ─── Layout Calculation ──────────────────────────────────────

/**
 * Calculate X/Y positions for all events.
 *
 * X-axis: derived from date ordinal, scaled and offset from the minimum date.
 * Y-axis: derived from arc grouping, each arc gets its own lane.
 *
 * @param events - Sorted or unsorted list of StoryEvents
 * @param config - Layout configuration (scale, spacing, dimensions)
 * @returns Map from nodeId to canvas Position
 */
export function calculateLayout(
  events: StoryEvent[],
  config: LayoutConfig = DEFAULT_LAYOUT_CONFIG,
): Map<string, Position> {
  const result = new Map<string, Position>();
  if (events.length === 0) return result;

  // Sort by date
  const sorted = [...events].sort((a, b) =>
    compareAbstractDates(a.date, b.date),
  );

  // Calculate date ordinals
  const ordinals = sorted.map(e => dateToOrdinal(e.date));
  const minOrdinal = Math.min(...ordinals);

  // Discover unique arcs in encounter order
  const arcOrder: string[] = [];
  for (const event of sorted) {
    if (!arcOrder.includes(event.arc)) arcOrder.push(event.arc);
  }

  // Track last X position per arc to enforce minimum gap
  const lastXPerArc = new Map<string, number>();

  for (let i = 0; i < sorted.length; i++) {
    const event = sorted[i];
    const arcIndex = arcOrder.indexOf(event.arc);

    let x: number;
    if (config.layoutMode === 'ordered') {
      // Ordered sequence: even spacing regardless of time gaps
      x = i * (config.nodeWidth + config.nodeGapX * 2);
    } else {
      // Absolute time graph: scaled by date ordinal
      x = (ordinals[i] - minOrdinal) * config.xScale;
      // Enforce minimum gap from previous node in same arc
      const lastX = lastXPerArc.get(event.arc);
      if (lastX !== undefined) {
        const minX = lastX + config.nodeWidth + config.nodeGapX;
        if (x < minX) x = minX;
      }
      lastXPerArc.set(event.arc, x);
    }

    // Y from arc
    const y = arcIndex * config.arcSpacing;

    result.set(event.nodeId, { x, y });
  }

  return result;
}

// ═══════════════════════════════════════
// LAYOUT ENGINE — X/Y coordinate calculator
// ═══════════════════════════════════════
// X = f(date ordinal), Y = f(arc index)

import type { AbstractDate, LayoutConfig, StoryEvent } from './canvasTypes';
import { DEFAULT_LAYOUT_CONFIG } from './canvasTypes';
import type { Position, Canvas } from './Canvas';

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
 * We approximate real time spans to prevent the canvas X-axis from exploding.
 * Last segment = Days (x1)
 * 2nd to last = Months (x30)
 * 3rd to last = Years (x365)
 * 4th to last = Ages (x365000)
 */
export function dateToOrdinal(date: AbstractDate): number {
  const multipliers = [1, 30, 365, 365000, 365000000];
  let ordinal = 0;
  for (let i = 0; i < date.length; i++) {
    const fromEnd = date.length - 1 - i;
    const mult = multipliers[fromEnd] ?? Math.pow(10, fromEnd + 2);
    ordinal += (date[i] ?? 0) * mult;
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

// ─── Inverse Layout (Coordinate → Data) ──────────────────────

/**
 * Derives the active Story Arc name based on a raw Y coordinate.
 * It reconstructs the active arc lanes by scanning existing nodes.
 */
export function getArcFromY(
  y: number, 
  events: StoryEvent[], 
  canvas: Canvas,
  config: LayoutConfig = DEFAULT_LAYOUT_CONFIG
): string {
  if (events.length === 0) return 'Main Plot'; // Fallback if canvas is empty
  
  // Reconstruct arc order by sorting nodes by their physical Y position
  const uniqueArcs = new Map<string, number>(); // arcName -> average Y
  
  for (const event of events) {
      if (!uniqueArcs.has(event.arc)) {
          // Find all events in this arc to average their Y (in case of slight misalignment)
          const arcEvents = events.filter(e => e.arc === event.arc);
          const yVals = arcEvents.map(e => canvas.nodes.get(e.nodeId)?.y ?? 0);
          const avgY = yVals.length > 0 ? (yVals.reduce((a, b) => a + b, 0) / yVals.length) : 0;
          uniqueArcs.set(event.arc, avgY);
      }
  }

  // Sort arcs by their average Y position from top to bottom
  const sortedArcs = Array.from(uniqueArcs.entries()).sort((a, b) => a[1] - b[1]);
  
  // Calculate which row index the clicked Y coordinate falls into
  // + (config.arcSpacing / 2) to snap to the closest lane rather than the floor
  let targetIndex = Math.floor((y + (config.arcSpacing / 2)) / config.arcSpacing);
  
  // Clamp index
  if (targetIndex < 0) targetIndex = 0;
  if (targetIndex >= sortedArcs.length) return sortedArcs[sortedArcs.length - 1][0];

  return sortedArcs[targetIndex][0];
}

/**
 * Interpolates an AbstractDate from a raw X coordinate.
 * In absolute mode, reverses the scaling math.
 * In ordered mode, interpolates between the two closest chronological nodes.
 */
export function getDateFromX(
  x: number,
  events: StoryEvent[],
  canvas: Canvas,
  config: LayoutConfig = DEFAULT_LAYOUT_CONFIG
): AbstractDate {
  if (events.length === 0) return [new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate()];

  if (config.layoutMode === 'absolute') {
      const ordinals = events.map(e => dateToOrdinal(e.date));
      const minOrdinal = Math.min(...ordinals);
      
      const targetOrdinal = (x / config.xScale) + minOrdinal;
      
      const sortedEvents = [...events].sort((a, b) => compareAbstractDates(a.date, b.date));
      const beforeEvents = sortedEvents.filter(e => dateToOrdinal(e.date) <= targetOrdinal);
      const afterEvents = sortedEvents.filter(e => dateToOrdinal(e.date) > targetOrdinal);
      
      const before = beforeEvents.length > 0 ? beforeEvents[beforeEvents.length - 1] : null;
      const after = afterEvents.length > 0 ? afterEvents[0] : null;
      
      if (before && after) {
         const d = [...before.date];
         if (d.length > 0) d[d.length - 1] = (d[d.length - 1] ?? 0) + 1;
         return d;
      }
      if (before) {
         const d = [...before.date];
         if (d.length > 0) d[d.length - 1] = (d[d.length - 1] ?? 0) + 1;
         return d;
      }
      if (after) {
         const d = [...after.date];
         if (d.length > 0) d[d.length - 1] = Math.max(1, (d[d.length - 1] ?? 2) - 1);
         return d;
      }
  } else {
      // Ordered layout: Sort physical nodes by X to find the chronological gap we're clicking into.
      const physicalNodes = events.map(e => {
         const nodeX = canvas.nodes.get(e.nodeId)?.x ?? 0;
         return { ...e, x: nodeX };
      }).sort((a, b) => a.x - b.x);

      const slotWidth = config.nodeWidth + config.nodeGapX * 2;
      let targetIndex = Math.floor((x + (slotWidth / 2)) / slotWidth);
      
      if (targetIndex <= 0) {
         const d = [...physicalNodes[0].date];
         if (d.length > 0) d[d.length - 1] = Math.max(1, (d[d.length - 1] ?? 2) - 1);
         return d;
      }
      if (targetIndex >= physicalNodes.length) {
         const d = [...physicalNodes[physicalNodes.length - 1].date];
         if (d.length > 0) d[d.length - 1] = (d[d.length - 1] ?? 0) + 1;
         return d;
      }
      
      const before = physicalNodes[targetIndex - 1];
      const d = [...before.date];
      if (d.length > 0) d[d.length - 1] = (d[d.length - 1] ?? 0) + 1;
      return d;
  }
  
  return [2000, 1, 1]; // Fallback
}

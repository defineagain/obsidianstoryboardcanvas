// ═══════════════════════════════════════
// DATE PARSER — Ported from obsidian-auto-timelines
// ═══════════════════════════════════════
// Decoupled from vault scan. Accepts CachedMetadata directly.
// Reads `story-date` key by default.

import type { CachedMetadata } from 'obsidian';
import type { AbstractDate, DateFormatSettings } from './canvasTypes';

// ─── Metadata Helpers ────────────────────────────────────────

/**
 * Read a typed value from note frontmatter.
 */
export function getMetadataKey<T extends 'string' | 'number' | 'boolean'>(
  cachedMetadata: CachedMetadata,
  key: string,
  type: T,
): (T extends 'string' ? string : T extends 'number' ? number : boolean) | undefined {
  if (!cachedMetadata.frontmatter) return undefined;
  return typeof cachedMetadata.frontmatter[key] === type
    ? cachedMetadata.frontmatter[key]
    : undefined;
}

// ─── Abstract Date Parsing ───────────────────────────────────

/**
 * Parse a date string into an AbstractDate using a configurable regex.
 *
 * @param groups - Comma-separated capture group names (e.g. "y,M,d")
 * @param value - The raw date string (e.g. "1000-03-15")
 * @param regex - The regex pattern with named capture groups
 * @returns AbstractDate array or undefined if parsing fails
 */
export function parseAbstractDate(
  groups: string[],
  value: string,
  regex: string,
): AbstractDate | undefined {
  try {
    const match = new RegExp(regex).exec(value);
    if (!match?.groups) return undefined;

    const result: AbstractDate = [];
    for (const group of groups) {
      const raw = match.groups[group.trim()];
      if (raw === undefined) return undefined;
      const num = parseInt(raw, 10);
      if (isNaN(num)) return undefined;
      result.push(num);
    }
    return result;
  } catch {
    return undefined;
  }
}

/**
 * Extract an AbstractDate from note metadata using the given key.
 *
 * @param cachedMetadata - Obsidian's cached metadata for the note
 * @param key - The frontmatter key to read (e.g. "story-date")
 * @param settings - Date format settings
 * @returns AbstractDate or undefined
 */
export function getAbstractDateFromMetadata(
  cachedMetadata: CachedMetadata,
  key: string,
  settings: DateFormatSettings,
): AbstractDate | undefined {
  if (!cachedMetadata.frontmatter) return undefined;

  const raw = cachedMetadata.frontmatter[key];
  if (raw === undefined || raw === null) return undefined;

  const groups = settings.dateParserGroupPriority.split(',');

  // Handle numbers (single-value dates like just a year)
  if (typeof raw === 'number') {
    const padding = [...Array(Math.max(0, groups.length - 1))].map(() => 1);
    return [raw, ...padding];
  }

  // Handle JavaScript Date objects (YAML dates become these in Obsidian)
  if (raw instanceof Date) {
    return [raw.getFullYear(), raw.getMonth() + 1, raw.getDate()];
  }

  // Handle objects with toISOString (another Date variant)
  if (typeof raw === 'object' && typeof raw.toISOString === 'function') {
    try {
      const d = new Date(raw.toISOString());
      return [d.getFullYear(), d.getMonth() + 1, d.getDate()];
    } catch {
      // fall through
    }
  }

  // Handle string values
  let str: string;
  if (typeof raw === 'string') {
    str = raw.trim();
  } else {
    str = String(raw).trim();
  }

  // Try ISO date string first (e.g. "2028-05-08T00:00:00.000Z")
  const isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    return [parseInt(isoMatch[1], 10), parseInt(isoMatch[2], 10), parseInt(isoMatch[3], 10)];
  }

  // Try slash-separated (e.g. "2026/4/10")
  const slashMatch = str.match(/^(-?\d+)\/(\d{1,2})\/(\d{1,2})/);
  if (slashMatch) {
    return [parseInt(slashMatch[1], 10), parseInt(slashMatch[2], 10), parseInt(slashMatch[3], 10)];
  }

  // Try dot-separated (e.g. "2026.4.10")
  const dotMatch = str.match(/^(-?\d+)\.(\d{1,2})\.(\d{1,2})/);
  if (dotMatch) {
    return [parseInt(dotMatch[1], 10), parseInt(dotMatch[2], 10), parseInt(dotMatch[3], 10)];
  }

  // Try Date.toString() format (e.g. "Wed May 08 2028 00:00:00 GMT...")
  const dateStringMatch = str.match(/\w+ (\w+) (\d+) (\d{4})/);
  if (dateStringMatch) {
    const months: Record<string, number> = {
      Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
      Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
    };
    const month = months[dateStringMatch[1]];
    if (month) {
      return [parseInt(dateStringMatch[3], 10), month, parseInt(dateStringMatch[2], 10)];
    }
  }

  // Fallback: try the configurable regex with normalized input
  const normalized = str.replace(/[/.]/g, '-');
  const result = parseAbstractDate(groups, normalized, settings.dateParserRegex);
  if (result) return result;

  // Nothing worked — log so user can diagnose
  console.warn(`[Storyboard Canvas] Could not parse '${key}' value:`, raw, `(type: ${typeof raw})`);
  return undefined;
}

/**
 * Read the story-arc value from note frontmatter.
 */
export function getArcFromMetadata(
  cachedMetadata: CachedMetadata,
  key: string = 'story-arc',
): string {
  return getMetadataKey(cachedMetadata, key, 'string') ?? 'default';
}

/**
 * Read the story-title value from note frontmatter, falling back to empty string.
 */
export function getTitleFromMetadata(
  cachedMetadata: CachedMetadata,
  key: string = 'story-title',
): string {
  return getMetadataKey(cachedMetadata, key, 'string') ?? '';
}

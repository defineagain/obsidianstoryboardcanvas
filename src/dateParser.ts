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

  // Handle string values (normalize separators)
  let str: string;
  if (typeof raw === 'string') {
    str = raw;
  } else if (raw instanceof Date || (typeof raw === 'object' && raw.toString)) {
    // Obsidian may parse YAML dates as Date objects
    str = raw.toString();
  } else {
    str = String(raw);
  }

  // Normalize: replace slashes and dots with hyphens for consistent matching
  const normalized = str.replace(/[/.]/g, '-');
  return parseAbstractDate(groups, normalized, settings.dateParserRegex);
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

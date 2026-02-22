// ═══════════════════════════════════════
// DATE FORMATTER — Ported from obsidian-auto-timelines
// ═══════════════════════════════════════
// Token-based formatting with conditional display logic.
// Supports fantasy calendars via DateTokenConfiguration.

import type {
  AbstractDate,
  DateTokenConfiguration,
  DateFormatSettings,
  AdditionalDateFormatting,
  Condition,
} from './canvasTypes';
import { DateTokenType } from './canvasTypes';

// ─── Type Guards ─────────────────────────────────────────────

function isNumberToken(
  config: DateTokenConfiguration,
): config is DateTokenConfiguration & { type: DateTokenType.number } {
  return config.type === DateTokenType.number;
}

function isStringToken(
  config: DateTokenConfiguration,
): config is DateTokenConfiguration & { type: DateTokenType.string } {
  return config.type === DateTokenType.string;
}

// ─── Condition Evaluator ─────────────────────────────────────

function evalNumericalCondition(
  condition: Condition,
  a: number,
  b: number,
): boolean {
  switch (condition) {
    case 'GREATER': return a > b;
    case 'LESS': return a < b;
    case 'EQUAL': return a === b;
    case 'NOTEQUAL': return a !== b;
    case 'GREATEROREQUAL': return a >= b;
    case 'LESSOREQUAL': return a <= b;
    default: return false;
  }
}

// ─── Token Formatters ────────────────────────────────────────

function formatNumberDateToken(
  datePart: number,
  config: DateTokenConfiguration & { type: DateTokenType.number },
): string {
  let minLen = config.minLeght < 0 ? 0 : config.minLeght;
  let str = Math.abs(datePart).toString();
  while (str.length < minLen) str = '0' + str;
  if (!config.hideSign && datePart < 0) str = `-${str}`;
  return str;
}

function formatStringDateToken(
  datePart: number,
  config: DateTokenConfiguration & { type: DateTokenType.string },
): string {
  return config.dictionary[datePart] ?? String(datePart);
}

function formatDateToken(
  datePart: number,
  config: DateTokenConfiguration,
): string {
  if (isNumberToken(config)) return formatNumberDateToken(datePart, config);
  if (isStringToken(config)) return formatStringDateToken(datePart, config);
  throw new Error('[Storyflow] Corrupted date token configuration');
}

// ─── Conditional Formatting ──────────────────────────────────

function applyConditionBasedFormatting(
  formattedDate: string,
  date: number,
  config: DateTokenConfiguration,
  enabled: boolean,
): string {
  if (!enabled) return formattedDate;

  return config.formatting.reduce(
    (output: string, fmt: AdditionalDateFormatting) => {
      const evalFn = fmt.conditionsAreExclusive
        ? fmt.evaluations.some.bind(fmt.evaluations)
        : fmt.evaluations.every.bind(fmt.evaluations);

      const passed = evalFn(({ condition, value }: { condition: Condition; value: number }) =>
        evalNumericalCondition(condition, date, value),
      );

      return passed ? fmt.format.replace('{value}', output) : output;
    },
    formattedDate,
  );
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Format an AbstractDate into a display string using the configured tokens.
 *
 * @param date - The abstract date to format
 * @param settings - Date format settings (display format, tokens, etc.)
 * @returns Formatted date string (e.g. "1000-03-15")
 */
export function formatAbstractDate(
  date: AbstractDate,
  settings: DateFormatSettings,
): string {
  const prioArray = settings.dateParserGroupPriority.split(',');
  let output = settings.dateDisplayFormat.toString();

  prioArray.forEach((token, index) => {
    const trimmed = token.trim();
    const config = settings.dateTokenConfiguration.find(
      ({ name }) => name === trimmed,
    );

    if (!config) {
      throw new Error(
        `[Storyflow] No date token configuration found for "${trimmed}"`,
      );
    }

    output = output.replace(
      `{${trimmed}}`,
      applyConditionBasedFormatting(
        formatDateToken(date[index], config),
        date[index],
        config,
        settings.applyAdditonalConditionFormatting,
      ),
    );
  });

  return output;
}

/**
 * Calculate the human-readable time interval between two AbstractDates.
 * Assumes a Gregorian-style [year, month, day] format by default.
 * @param dateA - The starting date
 * @param dateB - The ending date (chronologically after dateA)
 */
export function calculateDateInterval(dateA: AbstractDate, dateB: AbstractDate): string {
  if (dateA.length < 3 || dateB.length < 3) return "Later";

  const y1 = dateA[0] || 0;
  const m1 = dateA[1] || 0;
  const d1 = dateA[2] || 0;

  const y2 = dateB[0] || 0;
  const m2 = dateB[1] || 0;
  const d2 = dateB[2] || 0;

  let diffY = y2 - y1;
  let diffM = m2 - m1;
  let diffD = d2 - d1;

  if (diffD < 0) {
    diffM -= 1;
    diffD += 30; // Approximation for readability
  }
  if (diffM < 0) {
    diffY -= 1;
    diffM += 12;
  }

  if (diffY === 0 && diffM === 0 && diffD === 0) return "Same time";

  const parts = [];
  if (diffY > 0) parts.push(`${diffY} year${diffY > 1 ? 's' : ''}`);
  if (diffM > 0) parts.push(`${diffM} month${diffM > 1 ? 's' : ''}`);
  if (diffD > 0) parts.push(`${diffD} day${diffD > 1 ? 's' : ''}`);

  return parts.join(', ') + ' later';
}


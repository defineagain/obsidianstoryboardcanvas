// ═══════════════════════════════════════
// CANVAS STORYBOARD — TYPE DEFINITIONS
// ═══════════════════════════════════════
// Cherry-picked from obsidian-auto-timelines, stripped of Vue/i18n deps.

import type { TFile } from 'obsidian';

// ─── Abstract Date ───────────────────────────────────────────
/**
 * Flexible date representation for fantasy calendars.
 * Standard: [year, month, day]. Fantasy: [cycle, moon, phase, day].
 * All entries in a project must use the same segment count.
 */
export type AbstractDate = number[];

// ─── Date Token Configuration ────────────────────────────────

export enum DateTokenType {
  number = 'NUMBER',
  string = 'STRING',
}

export interface Evaluation<T extends number = number> {
  condition: Condition;
  value: T;
}

export enum Condition {
  Greater = 'GREATER',
  Less = 'LESS',
  Equal = 'EQUAL',
  NotEqual = 'NOTEQUAL',
  GreaterOrEqual = 'GREATEROREQUAL',
  LessOrEqual = 'LESSOREQUAL',
}

export interface AdditionalDateFormatting<T extends number = number> {
  evaluations: Evaluation<T>[];
  conditionsAreExclusive: boolean;
  /** Use `{value}` to include the pre-formatted token output. */
  format: string;
}

interface CommonDateTokenValues<T extends DateTokenType> {
  name: string;
  type: T;
  formatting: AdditionalDateFormatting[];
}

export interface NumberDateToken extends CommonDateTokenValues<DateTokenType.number> {
  minLeght: number;       // sic — matches upstream spelling
  displayWhenZero: boolean;
  hideSign: boolean;
}

export interface StringDateToken extends CommonDateTokenValues<DateTokenType.string> {
  dictionary: string[];
}

export type DateTokenConfiguration = NumberDateToken | StringDateToken;

// ─── Story Event ─────────────────────────────────────────────

export interface StoryEvent {
  nodeId: string;
  file: TFile;
  date: AbstractDate;
  endDate?: AbstractDate;
  arc: string;
  title: string;
  body?: string;
  imageUrl?: string;
}

// ─── Arc Configuration ───────────────────────────────────────

export interface ArcConfig {
  name: string;
  color: string;
  yOffset: number;
}

// ─── Layout Configuration ────────────────────────────────────

export interface LayoutConfig {
  /** Layout mode: 'absolute' (time graph) or 'ordered' (sequential grid). */
  layoutMode: 'absolute' | 'ordered';
  /** Pixels per date ordinal unit. */
  xScale: number;
  /** Y-axis gap between arc lanes. */
  arcSpacing: number;
  /** Default node width. */
  nodeWidth: number;
  /** Default node height. */
  nodeHeight: number;
  /** Minimum X gap between consecutive nodes on the same arc. */
  nodeGapX: number;
}

export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
  layoutMode: 'absolute',
  xScale: 10,
  arcSpacing: 500,
  nodeWidth: 400,
  nodeHeight: 300,
  nodeGapX: 50,
};

// ─── Date Format Settings ────────────────────────────────────

export interface DateFormatSettings {
  dateParserRegex: string;
  dateParserGroupPriority: string;
  dateDisplayFormat: string;
  dateTokenConfiguration: DateTokenConfiguration[];
  applyAdditonalConditionFormatting: boolean;  // sic — matches upstream
}

export const DEFAULT_DATE_FORMAT_SETTINGS: DateFormatSettings = {
  dateParserRegex: '(?<y>-?\\d+)[-/.](?<M>\\d+)[-/.](?<d>\\d+)',
  dateParserGroupPriority: 'y,M,d',
  dateDisplayFormat: '{y}-{M}-{d}',
  dateTokenConfiguration: [
    {
      name: 'y',
      type: DateTokenType.number,
      minLeght: 4,
      displayWhenZero: true,
      hideSign: false,
      formatting: [],
    },
    {
      name: 'M',
      type: DateTokenType.number,
      minLeght: 2,
      displayWhenZero: true,
      hideSign: true,
      formatting: [],
    },
    {
      name: 'd',
      type: DateTokenType.number,
      minLeght: 2,
      displayWhenZero: true,
      hideSign: true,
      formatting: [],
    },
  ],
  applyAdditonalConditionFormatting: false,
};

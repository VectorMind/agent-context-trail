import { PayloadExcerpt, ToolCallDetail, ToolCallDetailField } from '../domain/types';

// Shared host-side trimming for the on-demand Call detail card
// (plans/2026-07/07/call-details, OP-101/OP-102): the webview only ever
// receives a fixed-shape excerpt — 8 head lines, 4 tail lines, capped line
// length — never the full payload.

const HEAD_LINES = 8;
const TAIL_LINES = 4;
const MAX_LINE_CHARS = 400;
const MAX_FIELD_CHARS = 200;
/** A string value must be at least this long to count as the payload body. */
const PAYLOAD_MIN_CHARS = 161;

function capLine(line: string): string {
  return line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS - 1)}…` : line;
}

/** Fixed head/tail excerpt of a text payload (OP-102: 8 + 4 lines). */
export function buildExcerpt(text: string, reconstructed?: boolean): PayloadExcerpt {
  const lines = text.split(/\r?\n/);
  const totalLines = lines.length;
  const totalChars = text.length;

  let headLines: string[];
  let tailLines: string[] | undefined;
  if (totalLines <= HEAD_LINES + TAIL_LINES) {
    headLines = lines.map(capLine);
  } else {
    headLines = lines.slice(0, HEAD_LINES).map(capLine);
    tailLines = lines.slice(totalLines - TAIL_LINES).map(capLine);
  }
  const shownChars = [...headLines, ...(tailLines ?? [])].reduce((sum, l) => sum + l.length, 0);
  const excerpt: PayloadExcerpt = {
    headLines,
    tailLines,
    totalChars,
    totalLines,
    skippedChars: Math.max(0, totalChars - shownChars)
  };
  if (reconstructed) excerpt.reconstructed = true;
  return excerpt;
}

function fieldValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export interface SplitInput {
  fields: ToolCallDetailField[];
  /** The dominant text payload (file content, long command, ...), if any. */
  payload?: { key: string; text: string };
}

/**
 * Splits a tool's input into labeled scalar fields plus at most one dominant
 * text payload (the longest long string value — a Write's content, a long
 * Bash command...). The payload gets the head/tail excerpt treatment; every
 * other field is capped to a short single value. String inputs that aren't
 * objects (Codex raw arguments that fail JSON.parse) become the payload.
 */
export function splitInputFields(input: unknown): SplitInput {
  if (typeof input === 'string') {
    return input.length >= PAYLOAD_MIN_CHARS
      ? { fields: [], payload: { key: 'input', text: input } }
      : { fields: input ? [{ key: 'input', value: capField(input) }] : [] };
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { fields: input === undefined || input === null ? [] : [{ key: 'input', value: capField(fieldValue(input)) }] };
  }

  const entries = Object.entries(input as Record<string, unknown>);
  let payloadKey: string | undefined;
  let payloadText = '';
  for (const [key, value] of entries) {
    if (typeof value === 'string' && value.length >= PAYLOAD_MIN_CHARS && value.length > payloadText.length) {
      payloadKey = key;
      payloadText = value;
    }
  }

  const fields: ToolCallDetailField[] = [];
  for (const [key, value] of entries) {
    if (key === payloadKey) continue;
    if (value === undefined || value === null) continue;
    fields.push({ key, value: capField(fieldValue(value)) });
  }
  return payloadKey !== undefined ? { fields, payload: { key: payloadKey, text: payloadText } } : { fields };
}

function capField(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > MAX_FIELD_CHARS ? `${normalized.slice(0, MAX_FIELD_CHARS - 1)}…` : normalized;
}

/** Assembles the transport shape from split input + optional result text. */
export function buildToolCallDetail(
  toolCallId: string,
  input: unknown,
  resultText: string | undefined,
  resultReconstructed?: boolean
): ToolCallDetail {
  const split = splitInputFields(input);
  const detail: ToolCallDetail = { toolCallId, fields: split.fields };
  if (split.payload) {
    detail.inputExcerpt = buildExcerpt(split.payload.text);
    detail.inputPayloadKey = split.payload.key;
  }
  if (resultText !== undefined) detail.resultExcerpt = buildExcerpt(resultText, resultReconstructed);
  return detail;
}

export function unavailableDetail(toolCallId: string, reason: string): ToolCallDetail {
  return { toolCallId, fields: [], unavailable: reason };
}

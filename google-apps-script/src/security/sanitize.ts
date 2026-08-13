/**
 * The parse boundary.
 *
 * See IMPLEMENTATION_PLAN.md §19.3. Every request body passes through here
 * before any handler sees it, which is the whole point: a control applied per
 * handler is a control the next handler will not have.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS REFUSES, AND WHY
 * ---------------------------------------------------------------------------
 * **Prototype-pollution keys.** `JSON.parse` gives `__proto__` as an ordinary
 * own property — it does not, by itself, corrupt anything. The damage happens
 * one step later, when some downstream code does `target[key] = source[key]` in
 * a loop, or spreads into an object, and `__proto__` stops being data and
 * becomes an assignment to `Object.prototype`. Auditing every present and
 * future assignment is not a control; refusing the key at the door is.
 *
 * `constructor` and `prototype` are refused for the same reason.
 *
 * **Depth.** A payload nested a few thousand levels deep costs nothing to send
 * and blows the stack of any recursive walk — including this one, and including
 * `JSON.stringify` in the audit writer. The limit is far above anything a real
 * quotation reaches: the deepest legitimate path is
 * `payload.quotation.lines[0].description`, four levels.
 *
 * **Breadth.** A single array of a million empty objects is a cheap way to burn
 * a six-minute execution. Line items are capped at 500 by validation, but that
 * check happens after this one, and it only covers the fields it knows about.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES NOT DO
 * ---------------------------------------------------------------------------
 * It does not validate business rules, cap string lengths, or escape anything.
 * Those belong to the per-action validators and to the sheet-write layer, which
 * know what each field means. This is the structural check that makes it safe
 * for them to run at all.
 */

import { ApiError } from '../errors';

/** Keys that must never appear in a request body, at any depth. */
export const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'] as const;

/**
 * The deepest legitimate payload is about four levels
 * (`payload.quotation.lines[].description`). Twelve is generous.
 */
export const MAX_DEPTH = 12;

/**
 * Total nodes in one request. A 500-line quotation with 60 terms comes to a few
 * thousand; 200,000 is far above that and far below what would exhaust the
 * execution budget.
 */
export const MAX_NODES = 200_000;

/** Any single array. Line items cap at 500, terms at 60 — both well under. */
export const MAX_ARRAY_LENGTH = 5_000;

function reject(message: string): never {
  // Deliberately vague to the client: the specifics are a map of what the
  // parser will and will not accept. The detail goes to Cloud Logging.
  throw new ApiError('VALIDATION_FAILED', message);
}

/**
 * Walk a parsed body and refuse anything structurally dangerous.
 *
 * Iterative rather than recursive: a recursive walk is itself vulnerable to the
 * deep-nesting payload it is meant to catch, because the stack overflows before
 * the depth check ever runs.
 */
export function assertSafeStructure(root: unknown): void {
  const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  let nodes = 0;

  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry === undefined) break;

    const { value, depth } = entry;

    nodes += 1;
    if (nodes > MAX_NODES) reject('Request payload is too large.');
    if (depth > MAX_DEPTH) reject('Request payload is nested too deeply.');

    if (value === null || typeof value !== 'object') continue;

    if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY_LENGTH) reject('Request payload is too large.');
      for (const item of value) stack.push({ value: item, depth: depth + 1 });
      continue;
    }

    /*
     * `Object.keys` lists own enumerable keys, which is exactly the set
     * `JSON.parse` produces — including `__proto__` as an own property, which
     * is the one this has to see.
     */
    for (const key of Object.keys(value)) {
      if ((FORBIDDEN_KEYS as readonly string[]).indexOf(key) !== -1) {
        reject('Request payload contains a disallowed key.');
      }
      stack.push({ value: (value as Record<string, unknown>)[key], depth: depth + 1 });
    }
  }
}

/**
 * Parse a request body safely.
 *
 * The ONLY place this system turns a request string into an object. Anything
 * that gets past here is structurally sound; anything that does not never
 * reaches a handler.
 */
export function parseRequestBody(raw: string): unknown {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiError('VALIDATION_FAILED', 'Request body is not valid JSON.');
  }

  assertSafeStructure(parsed);
  return parsed;
}

/**
 * Strip characters that have no business in a stored value.
 *
 * C0 and C1 control characters, except tab, newline and carriage return, which
 * are legitimate in a term body or a scope paragraph. A NUL in a client name is
 * not user input in any meaningful sense — it is an attempt to confuse
 * something downstream that treats strings as C strings, or to hide the real
 * value from a person reading the sheet.
 *
 * Zero-width and bidirectional-override characters go too. A right-to-left
 * override inside a client name renders the rest of the cell backwards, which
 * is a way to make a spreadsheet row read as something other than what it
 * contains — and this system already prints one legitimate right-to-left
 * string, so "there is Arabic in it" is not a reason to leave them alone.
 *
 * Written with escapes rather than literal characters: a source file carrying a
 * raw NUL is a file every tool downstream treats as binary.
 */
const UNSAFE_CHARACTER_SOURCE =
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]';

export function stripUnsafeCharacters(value: string): string {
  return value.replace(new RegExp(UNSAFE_CHARACTER_SOURCE, 'g'), '');
}

/** True when a string carries a character `stripUnsafeCharacters` would remove. */
export function hasUnsafeCharacters(value: string): boolean {
  return new RegExp(UNSAFE_CHARACTER_SOURCE).test(value);
}

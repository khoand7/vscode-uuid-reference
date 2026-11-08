/**
 * Shared UUID helpers. No `vscode` import here so this module stays unit-testable.
 */

/** Regex source for the canonical 8-4-4-4-12 hex UUID form. */
export const UUID_PATTERN =
    '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

const UUID_EXACT_REGEX = new RegExp(`^${UUID_PATTERN}$`);

/** True when the whole string is a UUID (surrounding whitespace allowed). */
export function isUuid(value: string): boolean {
    return UUID_EXACT_REGEX.test(value.trim());
}

/** Canonical lowercase form used as the index key. */
export function normalizeUuid(value: string): string {
    return value.trim().toLowerCase();
}

/** All UUIDs contained in a text blob, in order of appearance. */
export function findUuidsIn(text: string): string[] {
    return text.match(new RegExp(UUID_PATTERN, 'g')) ?? [];
}

/** First UUID contained in a text blob, if any. */
export function firstUuidIn(text: string): string | undefined {
    const match = new RegExp(UUID_PATTERN).exec(text);
    return match ? match[0] : undefined;
}

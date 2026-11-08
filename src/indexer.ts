/**
 * Extracts UUID → description entries from parsed JSON.
 * Pure module (no `vscode` import) so it can be unit-tested with plain Node.
 *
 * Supported JSON shapes:
 *  1. Top-level array of objects:            [{ "id": "<uuid>", "description": "…" }, …]
 *  2. Object wrapping arrays / nesting:      { "services": [ { "id": …, "description": … } ] }
 *  3. Direct UUID → string map:              { "<uuid>": "description" }
 *  4. Direct UUID → object map:              { "<uuid>": { "description": "…" } }
 *
 * Keys are read via configurable dot-paths (e.g. `meta.id`, `details.label`).
 */

import { isUuid, normalizeUuid } from './uuid';

export interface DefinitionEntry {
    /** UUID exactly as written in the source file. */
    uuid: string;
    /** Lowercased UUID — the lookup key. */
    normalizedUuid: string;
    /** Human-readable description (may be ''). */
    description: string;
    /** Absolute path of the file this entry came from. */
    sourcePath: string;
}

export interface ExtractOptions {
    uuidKey: string;
    descriptionKey: string;
    sourcePath: string;
}

/** Safety net against pathologically nested documents. */
const MAX_DEPTH = 12;

/** Resolve a dot-separated key path against an object; undefined when missing. */
function getByPath(obj: unknown, keyPath: string): unknown {
    let current: unknown = obj;
    for (const part of keyPath.split('.')) {
        if (current === null || current === undefined || typeof current !== 'object') {
            return undefined;
        }
        current = (current as Record<string, unknown>)[part];
    }
    return current;
}

function stringifyDescription(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    if (value === null || value === undefined) {
        return '';
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

export function extractEntries(root: unknown, opts: ExtractOptions): DefinitionEntry[] {
    const out: DefinitionEntry[] = [];

    const pushEntry = (uuidValue: unknown, descriptionValue: unknown): void => {
        if (typeof uuidValue !== 'string' || !isUuid(uuidValue)) {
            return;
        }
        const uuid = uuidValue.trim();
        out.push({
            uuid,
            normalizedUuid: normalizeUuid(uuid),
            description: stringifyDescription(descriptionValue),
            sourcePath: opts.sourcePath,
        });
    };

    const walk = (node: unknown, depth: number): void => {
        if (depth > MAX_DEPTH || node === null || node === undefined) {
            return;
        }
        if (Array.isArray(node)) {
            for (const item of node) {
                walk(item, depth + 1);
            }
            return;
        }
        if (typeof node !== 'object') {
            return;
        }
        const record = node as Record<string, unknown>;

        // Shape 1/2: an object that carries the UUID under the configured key.
        const uuidValue = getByPath(record, opts.uuidKey);
        if (typeof uuidValue === 'string' && isUuid(uuidValue)) {
            pushEntry(uuidValue, getByPath(record, opts.descriptionKey));
            return;
        }

        // Shape 3/4 + wrapper objects.
        for (const [key, value] of Object.entries(record)) {
            if (isUuid(key)) {
                if (value === null || value === undefined) {
                    pushEntry(key, '');
                } else if (typeof value === 'object') {
                    const desc = getByPath(value, opts.descriptionKey);
                    pushEntry(key, desc !== undefined ? desc : value);
                } else {
                    pushEntry(key, value);
                }
            } else if (value !== null && typeof value === 'object') {
                walk(value, depth + 1);
            }
        }
    };

    walk(root, 0);
    return out;
}

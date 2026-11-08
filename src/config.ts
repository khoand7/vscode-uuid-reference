/**
 * Reads the extension's user configuration and resolves source file paths.
 */

import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

export interface SourceConfig {
    /** Path to the JSON definition file (absolute, `~`, `${workspaceFolder}` or workspace-relative). */
    path: string;
    /** Key containing the UUID. Defaults to {@link DEFAULT_UUID_KEY}. */
    uuidKey?: string;
    /** Key containing the description. Defaults to {@link DEFAULT_DESCRIPTION_KEY}. */
    descriptionKey?: string;
}

export const DEFAULT_UUID_KEY = 'id';
export const DEFAULT_DESCRIPTION_KEY = 'description';

const SECTION = 'uuidReference';

function cfg(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(SECTION);
}

/** All configured sources, with empty/invalid entries filtered out. */
export function getSources(): SourceConfig[] {
    const raw = cfg().get<SourceConfig[]>('sources') ?? [];
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw.filter(
        (s): s is SourceConfig =>
            !!s && typeof s === 'object' && typeof s.path === 'string' && s.path.trim().length > 0
    );
}

export function hoverEnabled(): boolean {
    return cfg().get<boolean>('hover.enabled', true);
}

export function statusBarEnabled(): boolean {
    return cfg().get<boolean>('statusBar.enabled', true);
}

export function statusBarMaxLength(): number {
    const n = cfg().get<number>('statusBar.maxLength', 60);
    return Number.isFinite(n) && n >= 10 ? Math.floor(n) : 60;
}

/** First workspace folder path, if any. */
export function workspaceRoot(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    return folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
}

/**
 * Turn a user-provided path into an absolute filesystem path.
 * Supports `~/…`, `${workspaceFolder}/…`, workspace-relative and absolute paths.
 */
export function resolveSourcePath(rawPath: string): string | undefined {
    const root = workspaceRoot();
    let p = rawPath.trim();
    if (!p) {
        return undefined;
    }
    if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) {
        p = path.join(os.homedir(), p.slice(1).replace(/^[\\/]+/, ''));
    }
    if (p.includes('${workspaceFolder}')) {
        if (!root) {
            return undefined; // cannot resolve without a workspace
        }
        p = p.replace(/\$\{workspaceFolder\}/g, root);
    }
    if (path.isAbsolute(p)) {
        return path.normalize(p);
    }
    if (root) {
        return path.normalize(path.join(root, p));
    }
    return path.resolve(p);
}

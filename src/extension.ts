import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import {
    DEFAULT_DESCRIPTION_KEY,
    DEFAULT_UUID_KEY,
    SourceConfig,
    getSources,
    hoverEnabled,
    resolveSourcePath,
    statusBarEnabled,
    statusBarMaxLength,
    workspaceRoot,
} from './config';
import { DefinitionEntry, extractEntries } from './indexer';
import { UUID_PATTERN, firstUuidIn } from './uuid';

/* -------------------------------------------------------------------------- */
/*  Index: loads all configured JSON sources into one lookup map              */
/* -------------------------------------------------------------------------- */

class UuidIndex {
    private entries = new Map<string, DefinitionEntry>();
    private warnings: string[] = [];
    private loaded = false;
    private loading: Promise<void> | undefined;

    constructor(private readonly output: vscode.OutputChannel) {}

    /** Loads the index once; safe to call from hot paths (hover, selection). */
    ensureLoaded(): Promise<void> {
        if (!this.loaded) {
            return this.reload();
        }
        return this.loading ?? Promise.resolve();
    }

    /** (Re)reads every configured source file and rebuilds the lookup map. */
    async reload(): Promise<void> {
        if (!this.loading) {
            this.loading = this.reloadInternal().finally(() => {
                this.loading = undefined;
            });
        }
        return this.loading;
    }

    private async reloadInternal(): Promise<void> {
        this.loaded = true;
        const next = new Map<string, DefinitionEntry>();
        const warnings: string[] = [];
        let fileCount = 0;

        for (const src of getSources()) {
            const resolved = resolveSourcePath(src.path);
            if (!resolved) {
                warnings.push(`Could not resolve path "${src.path}" (is a workspace folder open?)`);
                continue;
            }

            let text: string;
            try {
                text = await fs.promises.readFile(resolved, 'utf8');
            } catch (err) {
                warnings.push(`Cannot read ${resolved}: ${(err as Error).message}`);
                continue;
            }

            let root: unknown;
            try {
                root = JSON.parse(text);
            } catch (err) {
                warnings.push(`Invalid JSON in ${resolved}: ${(err as Error).message}`);
                continue;
            }

            fileCount++;
            const extracted = extractEntries(root, {
                uuidKey: (src.uuidKey ?? '').trim() || DEFAULT_UUID_KEY,
                descriptionKey: (src.descriptionKey ?? '').trim() || DEFAULT_DESCRIPTION_KEY,
                sourcePath: resolved,
            });

            let duplicates = 0;
            for (const entry of extracted) {
                if (next.has(entry.normalizedUuid)) {
                    duplicates++; // first source wins
                    continue;
                }
                next.set(entry.normalizedUuid, entry);
            }
            this.output.appendLine(
                `Loaded ${extracted.length} definition(s) from ${resolved}` +
                    (duplicates ? ` — skipped ${duplicates} duplicate UUID(s)` : '')
            );
        }

        this.entries = next;
        this.warnings = warnings;
        for (const w of warnings) {
            this.output.appendLine(`WARNING: ${w}`);
        }
        this.output.appendLine(`Index ready: ${next.size} UUID(s) from ${fileCount} file(s).`);
    }

    get(uuid: string): DefinitionEntry | undefined {
        return this.entries.get(uuid.trim().toLowerCase());
    }

    all(): DefinitionEntry[] {
        return [...this.entries.values()];
    }

    getWarnings(): string[] {
        return [...this.warnings];
    }

    size(): number {
        return this.entries.size;
    }
}

/* -------------------------------------------------------------------------- */
/*  Small helpers                                                             */
/* -------------------------------------------------------------------------- */

function collapseWhitespace(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

function truncate(text: string, max: number): string {
    return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

/* -------------------------------------------------------------------------- */
/*  Activation                                                                */
/* -------------------------------------------------------------------------- */

export function activate(context: vscode.ExtensionContext) {
    const output = vscode.window.createOutputChannel('UUID Reference');
    const index = new UuidIndex(output);
    context.subscriptions.push(output);

    /* ----------------------------- Status bar ----------------------------- */

    const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusItem.command = 'uuidReference.lookup';
    context.subscriptions.push(statusItem);

    let statusToken = 0; // guards against stale async updates
    const updateStatusBar = (): void => {
        const token = ++statusToken;

        if (!statusBarEnabled()) {
            statusItem.hide();
            return;
        }
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            statusItem.hide();
            return;
        }

        const selected = editor.document.getText(editor.selection).trim();
        const uuid = firstUuidIn(selected);
        if (!uuid) {
            statusItem.hide();
            return;
        }

        void index.ensureLoaded().then(() => {
            if (token !== statusToken) {
                return; // selection changed while we were loading
            }
            const entry = index.get(uuid);
            if (entry) {
                const desc = collapseWhitespace(entry.description);
                statusItem.text = desc
                    ? `$(book) ${truncate(desc, statusBarMaxLength())}`
                    : `$(book) ${uuid}`;
                statusItem.tooltip = new vscode.MarkdownString(
                    `**${uuid}**\n\n${entry.description || '_No description_'}\n\n_Source: ${entry.sourcePath}_`
                );
            } else {
                statusItem.text = `$(question) ${uuid.slice(0, 8)}… — not in definitions`;
                statusItem.tooltip = `No definition found for ${uuid}.\nClick to look it up, or add sources in the UUID Reference settings.`;
            }
            statusItem.show();
        });
    };

    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(updateStatusBar),
        vscode.window.onDidChangeActiveTextEditor(updateStatusBar)
    );

    /* --------------------------- File watching ---------------------------- */

    let watcherDisposables: vscode.Disposable[] = [];
    const rebuildWatchers = (): void => {
        watcherDisposables.forEach(d => d.dispose());
        watcherDisposables = [];

        const dirToNames = new Map<string, Set<string>>();
        for (const src of getSources()) {
            const resolved = resolveSourcePath(src.path);
            if (!resolved) {
                continue;
            }
            const dir = path.dirname(resolved);
            if (!dirToNames.has(dir)) {
                dirToNames.set(dir, new Set());
            }
            dirToNames.get(dir)!.add(path.basename(resolved));
        }

        dirToNames.forEach((names, dir) => {
            const nameList = [...names];
            const pattern = nameList.length === 1 ? nameList[0] : `{${nameList.join(',')}}`;
            try {
                const watcher = vscode.workspace.createFileSystemWatcher(
                    new vscode.RelativePattern(vscode.Uri.file(dir), pattern)
                );
                const onFileEvent = () => {
                    void index.reload().then(updateStatusBar);
                };
                watcher.onDidChange(onFileEvent, null, context.subscriptions);
                watcher.onDidCreate(onFileEvent, null, context.subscriptions);
                watcher.onDidDelete(onFileEvent, null, context.subscriptions);
                watcherDisposables.push(watcher);
                context.subscriptions.push(watcher);
            } catch {
                // watching is best-effort (e.g. unsupported path); reload command still works
            }
        });
    };

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('uuidReference')) {
                void index.reload().then(() => {
                    rebuildWatchers();
                    updateStatusBar();
                });
            }
        })
    );

    /* --------------------------- Hover provider ---------------------------- */

    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            [{ scheme: 'file' }, { scheme: 'untitled' }],
            {
                provideHover(document, position) {
                    if (!hoverEnabled()) {
                        return undefined;
                    }
                    void index.ensureLoaded();

                    const line = document.lineAt(position.line).text;
                    const re = new RegExp(UUID_PATTERN, 'g');
                    let m: RegExpExecArray | null;
                    while ((m = re.exec(line)) !== null) {
                        const start = m.index;
                        const end = start + m[0].length;
                        if (position.character < start) {
                            break;
                        }
                        if (position.character > end) {
                            continue;
                        }
                        const entry = index.get(m[0]);
                        if (!entry) {
                            return undefined; // unknown UUID → stay quiet
                        }
                        const md = new vscode.MarkdownString();
                        md.appendMarkdown('**$(book) UUID Reference**\n\n');
                        md.appendMarkdown(`\`${entry.uuid}\`\n\n`);
                        md.appendMarkdown(`${entry.description || '_No description_'}\n\n`);
                        md.appendMarkdown(`_Source: ${entry.sourcePath}_`);
                        return new vscode.Hover(md, new vscode.Range(
                            position.line, start,
                            position.line, end
                        ));
                    }
                    return undefined;
                },
            }
        )
    );

    /* ------------------------------ Commands ------------------------------- */

    /** Details QuickPick for a single entry (copy description / UUID, open file). */
    const showEntryDetails = (entry: DefinitionEntry): void => {
        const qp = vscode.window.createQuickPick();
        qp.title = entry.uuid;
        qp.placeholder = collapseWhitespace(entry.description) || '(no description)';
        qp.matchOnDescription = false;
        qp.matchOnDetail = false;
        qp.items = [
            { label: '$(copy) Copy description', detail: collapseWhitespace(entry.description) || '(empty)' },
            { label: '$(copy) Copy UUID', detail: entry.uuid },
            { label: '$(file) Open source file', detail: entry.sourcePath },
        ];
        qp.onDidAccept(async () => {
            const item = qp.selectedItems[0];
            qp.hide();
            if (!item) {
                return;
            }
            if (item.label.includes('Copy description')) {
                await vscode.env.clipboard.writeText(entry.description);
                vscode.window.setStatusBarMessage('$(check) Description copied', 2000);
            } else if (item.label.includes('Copy UUID')) {
                await vscode.env.clipboard.writeText(entry.uuid);
                vscode.window.setStatusBarMessage('$(check) UUID copied', 2000);
            } else if (item.label.includes('Open source file')) {
                try {
                    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(entry.sourcePath));
                    await vscode.window.showTextDocument(doc);
                } catch (err) {
                    void vscode.window.showErrorMessage(`Cannot open ${entry.sourcePath}: ${(err as Error).message}`);
                }
            }
        });
        qp.onDidHide(() => qp.dispose());
        qp.show();
    };

    /** Text to look up: current selection, else the UUID under the cursor. */
    const getLookupText = (): string | undefined => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return undefined;
        }
        const selected = editor.document.getText(editor.selection).trim();
        if (selected) {
            return selected;
        }
        const range = editor.document.getWordRangeAtPosition(
            editor.selection.active,
            new RegExp(UUID_PATTERN)
        );
        if (range) {
            return editor.document.getText(range);
        }
        return undefined;
    };

    context.subscriptions.push(
        vscode.commands.registerCommand('uuidReference.lookup', async () => {
            await index.ensureLoaded();

            const text = getLookupText();
            if (text === undefined) {
                const pick = await vscode.window.showErrorMessage(
                    'Select a UUID (or place the cursor on one) to look it up.',
                    'Browse All UUIDs',
                    'Open Settings'
                );
                if (pick === 'Browse All UUIDs') {
                    void vscode.commands.executeCommand('uuidReference.browse');
                } else if (pick === 'Open Settings') {
                    void vscode.commands.executeCommand('uuidReference.openSettings');
                }
                return;
            }

            const uuid = firstUuidIn(text);
            if (!uuid) {
                void vscode.window.showWarningMessage(
                    `“${truncate(collapseWhitespace(text), 40)}” does not look like a UUID.`
                );
                return;
            }

            const entry = index.get(uuid);
            if (!entry) {
                const pick = await vscode.window.showWarningMessage(
                    `No definition found for ${uuid}`,
                    'Browse All UUIDs',
                    'Reload Definition Files',
                    'Open Settings'
                );
                if (pick === 'Browse All UUIDs') {
                    void vscode.commands.executeCommand('uuidReference.browse');
                } else if (pick === 'Reload Definition Files') {
                    void vscode.commands.executeCommand('uuidReference.reload');
                } else if (pick === 'Open Settings') {
                    void vscode.commands.executeCommand('uuidReference.openSettings');
                }
                return;
            }
            showEntryDetails(entry);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('uuidReference.browse', async () => {
            await index.ensureLoaded();
            const entries = index.all();
            if (entries.length === 0) {
                const pick = await vscode.window.showInformationMessage(
                    'No UUID definitions loaded yet. Point the extension at one or more JSON files.',
                    'Add Definition File…',
                    'Open Settings'
                );
                if (pick === 'Add Definition File…') {
                    void vscode.commands.executeCommand('uuidReference.addSource');
                } else if (pick === 'Open Settings') {
                    void vscode.commands.executeCommand('uuidReference.openSettings');
                }
                return;
            }

            type BrowseItem = vscode.QuickPickItem & { entry: DefinitionEntry };
            const qp = vscode.window.createQuickPick<BrowseItem>();
            qp.placeholder = `Search ${entries.length} UUID definition(s) by description, UUID or file…`;
            qp.matchOnDescription = true;
            qp.matchOnDetail = true;
            qp.items = entries.map(entry => ({
                label: collapseWhitespace(entry.description) || '(no description)',
                description: entry.uuid,
                detail: `$(file-json) ${path.basename(entry.sourcePath)}`,
                entry,
            }));
            qp.onDidAccept(() => {
                const item = qp.selectedItems[0];
                qp.hide();
                if (item) {
                    showEntryDetails(item.entry);
                }
            });
            qp.onDidHide(() => qp.dispose());
            qp.show();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('uuidReference.reload', async () => {
            await index.reload();
            rebuildWatchers();
            updateStatusBar();

            const message = `UUID Reference: ${index.size()} definition(s) loaded.`;
            const warnings = index.getWarnings();
            if (warnings.length > 0) {
                const pick = await vscode.window.showWarningMessage(
                    `${message} ${warnings.length} problem(s) — see output for details.`,
                    'Show Output'
                );
                if (pick === 'Show Output') {
                    output.show();
                }
            } else {
                vscode.window.setStatusBarMessage(`$(check) ${message}`, 3000);
            }
            output.show(true);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('uuidReference.openSettings', () =>
            vscode.commands.executeCommand('workbench.action.openSettings', 'uuidReference')
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('uuidReference.addSource', async () => {
            const uris = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                openLabel: 'Select JSON definition file',
                filters: { 'JSON Files': ['json'] },
            });
            if (!uris || uris.length === 0) {
                return;
            }
            const fileUri = uris[0];

            const uuidKey = await vscode.window.showInputBox({
                title: 'UUID key (1/2)',
                prompt: 'Key that contains the UUID — dot paths supported (e.g. meta.id)',
                value: DEFAULT_UUID_KEY,
            });
            if (uuidKey === undefined) {
                return;
            }
            const descriptionKey = await vscode.window.showInputBox({
                title: 'Description key (2/2)',
                prompt: 'Key that contains the description — dot paths supported (e.g. details.label)',
                value: DEFAULT_DESCRIPTION_KEY,
            });
            if (descriptionKey === undefined) {
                return;
            }

            let target = vscode.ConfigurationTarget.Global;
            let storedPath = fileUri.fsPath;

            const root = workspaceRoot();
            if (root) {
                interface ScopeItem extends vscode.QuickPickItem {
                    target: vscode.ConfigurationTarget;
                }
                const scopePick = await vscode.window.showQuickPick<ScopeItem>(
                    [
                        {
                            label: '$(repo) Workspace',
                            description: 'Saved in .vscode/settings.json (this workspace only)',
                            target: vscode.ConfigurationTarget.Workspace,
                        },
                        {
                            label: '$(account) Global (User)',
                            description: 'Saved in your user settings (all workspaces)',
                            target: vscode.ConfigurationTarget.Global,
                        },
                    ],
                    { title: 'Configuration scope', placeHolder: 'Where should this source be saved?' }
                );
                if (!scopePick) {
                    return;
                }
                target = scopePick.target;
                if (
                    target === vscode.ConfigurationTarget.Workspace &&
                    fileUri.fsPath.startsWith(root + path.sep)
                ) {
                    storedPath = path.relative(root, fileUri.fsPath).split(path.sep).join('/');
                }
            }

            const cfg = vscode.workspace.getConfiguration('uuidReference');
            const sources = [...(cfg.get<SourceConfig[]>('sources') ?? [])];
            sources.push({
                path: storedPath,
                uuidKey: uuidKey.trim() || DEFAULT_UUID_KEY,
                descriptionKey: descriptionKey.trim() || DEFAULT_DESCRIPTION_KEY,
            });
            await cfg.update('sources', sources, target);

            await index.reload();
            rebuildWatchers();
            updateStatusBar();
            void vscode.window.showInformationMessage(
                `UUID Reference: added ${path.basename(storedPath)} — ${index.size()} definition(s) indexed.`
            );
        })
    );

    /* ------------------------------ Startup -------------------------------- */

    void index.reload().then(() => {
        rebuildWatchers();
        updateStatusBar();
        output.appendLine('UUID Reference activated.');
    });

    // Small API for other extensions / tests.
    return {
        lookup: (uuid: string) => index.get(uuid),
        all: () => index.all(),
        reload: () => index.reload(),
    };
}

export function deactivate(): void {
    // Disposables are handled via context.subscriptions.
}

/**
 * Runtime smoke test: loads the compiled extension against a minimal `vscode`
 * API mock and exercises the main flows (activate, index loading from real
 * sample files, status bar update, hover, command handlers).
 *
 * Run with:  npm run compile && node scripts/smoke-activate.js
 */
'use strict';

const Module = require('module');
const path = require('path');
const assert = require('assert');

const SAMPLE_FILE = path.join(__dirname, '..', 'samples', 'service-registry.json');
const KNOWN_UUID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

/* ------------------------------ vscode mock ------------------------------ */

const registeredCommands = new Map();
const statusItems = [];
const hoverProviders = [];
let mockSources = [{ path: SAMPLE_FILE }];

const disposable = () => ({ dispose() {} });

const vscodeMock = {
    workspace: {
        workspaceFolders: [],
        getConfiguration: () => ({
            get: (key, def) => (key === 'sources' ? mockSources : def),
            update: async () => {},
        }),
        onDidChangeConfiguration: () => disposable(),
        createFileSystemWatcher: () => ({
            onDidChange: () => disposable(),
            onDidCreate: () => disposable(),
            onDidDelete: () => disposable(),
            dispose() {},
        }),
        openTextDocument: async () => ({}),
    },
    window: {
        activeTextEditor: {
            document: { getText: () => `selected: ${KNOWN_UUID}` },
            selection: { active: { line: 0, character: 0 } },
        },
        createOutputChannel: () => ({ appendLine: () => {}, show: () => {}, dispose() {} }),
        createStatusBarItem: () => {
            const item = { text: '', tooltip: '', command: '', shown: false, show() { this.shown = true; }, hide() { this.shown = false; }, dispose() {} };
            statusItems.push(item);
            return item;
        },
        onDidChangeTextEditorSelection: () => disposable(),
        onDidChangeActiveTextEditor: () => disposable(),
        showInformationMessage: async () => undefined,
        showWarningMessage: async () => undefined,
        showErrorMessage: async () => undefined,
        showQuickPick: async () => undefined,
        showInputBox: async () => undefined,
        showOpenDialog: async () => undefined,
        setStatusBarMessage: () => disposable(),
        createQuickPick: () => ({
            items: [], title: '', placeholder: '',
            matchOnDescription: false, matchOnDetail: false,
            onDidAccept: () => disposable(), onDidHide: () => disposable(),
            show() {}, hide() {}, dispose() {},
        }),
    },
    languages: {
        registerHoverProvider: (selector, provider) => {
            hoverProviders.push(provider);
            return disposable();
        },
    },
    commands: {
        registerCommand: (id, cb) => {
            registeredCommands.set(id, cb);
            return disposable();
        },
        executeCommand: async () => undefined,
    },
    env: { clipboard: { readText: async () => '', writeText: async () => {} } },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    MarkdownString: class {
        constructor(v) { this.value = v || ''; }
        appendMarkdown(s) { this.value += s; return this; }
    },
    Range: class {
        constructor(a, b, c, d) { this.start = { line: a, character: b }; this.end = { line: c, character: d }; }
    },
    Hover: class {
        constructor(md, range) { this.contents = [md]; this.range = range; }
    },
    RelativePattern: class {
        constructor(base, pattern) { this.base = base; this.pattern = pattern; }
    },
    Uri: { file: (p) => ({ fsPath: p, scheme: 'file' }) },
};

const origLoad = Module._load;
Module._load = function (request) {
    if (request === 'vscode') {
        return vscodeMock;
    }
    return origLoad.apply(this, arguments);
};

/* --------------------------------- run ----------------------------------- */

const ext = require('../out/extension.js');
const api = ext.activate({ subscriptions: [] });

setTimeout(async () => {
    const errors = [];
    const check = (name, fn) => {
        try { fn(); console.log(`  ✓ ${name}`); }
        catch (e) { errors.push(name); console.error(`  ✗ ${name}\n      ${e.message}`); }
    };

    console.log('smoke tests:');

    check('all 5 commands registered', () => {
        for (const c of ['uuidReference.lookup', 'uuidReference.browse', 'uuidReference.reload', 'uuidReference.addSource', 'uuidReference.openSettings']) {
            assert.ok(registeredCommands.has(c), `missing ${c}`);
        }
    });

    check('index loaded definitions from configured sample source', () => {
        assert.strictEqual(typeof api.lookup, 'function');
        assert.ok(api.all().length >= 6, `expected >=6 entries, got ${api.all().length}`);
        const entry = api.lookup(KNOWN_UUID);
        assert.ok(entry, 'known UUID not found in index');
        assert.ok(entry.description.includes('Authentication'), `unexpected description: ${entry.description}`);
    });

    check('case-insensitive lookup works', () => {
        assert.ok(api.lookup(KNOWN_UUID.toUpperCase()), 'uppercase lookup failed');
    });

    check('status bar shows description for selected UUID', () => {
        assert.ok(statusItems.length === 1, 'status bar item not created');
        const item = statusItems[0];
        assert.ok(item.shown, 'status bar item not shown');
        assert.ok(item.text.includes('User Authentication'), `unexpected status text: "${item.text}"`);
        assert.strictEqual(item.command, 'uuidReference.lookup');
    });

    check('hover provider returns description for known UUID', () => {
        assert.strictEqual(hoverProviders.length, 1);
        const line = `const serviceId = "${KNOWN_UUID}";`;
        const fakeDoc = { lineAt: () => ({ text: line }) };
        const pos = { line: 0, character: line.indexOf(KNOWN_UUID) + 5 };
        const hover = hoverProviders[0].provideHover(fakeDoc, pos, {});
        assert.ok(hover, 'no hover returned');
        assert.ok(hover.contents[0].value.includes('Authentication'), 'hover missing description');
        assert.strictEqual(hover.range.start.character, line.indexOf(KNOWN_UUID));
    });

    check('hover stays quiet for unknown UUID', () => {
        const unknown = '00000000-0000-4000-8000-000000000000';
        const line = `x = "${unknown}"`;
        const fakeDoc = { lineAt: () => ({ text: line }) };
        const hover = hoverProviders[0].provideHover(fakeDoc, { line: 0, character: 8 }, {});
        assert.strictEqual(hover, undefined, 'unexpected hover for unknown UUID');
    });

    const run = async (name, cmd) => {
        try { await registeredCommands.get(cmd)(); console.log(`  ✓ command "${name}" executed`); }
        catch (e) { errors.push(name); console.error(`  ✗ command "${name}" threw: ${e.message}`); }
    };
    await run('lookup', 'uuidReference.lookup');
    await run('browse', 'uuidReference.browse');
    await run('reload', 'uuidReference.reload');
    await run('openSettings', 'uuidReference.openSettings');
    await run('addSource (dialog cancelled)', 'uuidReference.addSource');

    if (errors.length) {
        console.error(`\nSMOKE FAILED: ${errors.length} problem(s)`);
        process.exit(1);
    }
    console.log('\nSMOKE OK — activation, indexing, status bar, hover and all commands work.');
    process.exit(0);
}, 300);

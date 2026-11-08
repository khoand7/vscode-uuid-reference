/**
 * Unit tests for the JSON indexer (pure Node — no VS Code required).
 * Run with:  npm run compile && npm test
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { extractEntries } = require('../out/indexer.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  ✓ ${name}`);
    } catch (err) {
        failed++;
        console.error(`  ✗ ${name}`);
        console.error(`      ${err.message}`);
    }
}

const OPTS = { uuidKey: 'id', descriptionKey: 'description', sourcePath: '/fake/source.json' };

console.log('indexer tests:');

test('shape 1: top-level array of objects with default keys', () => {
    const root = [
        { id: 'F47AC10B-58CC-4372-A567-0E02B2C3D479', description: 'Auth service' },
        { id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8', description: 'Billing' },
    ];
    const entries = extractEntries(root, OPTS);
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].normalizedUuid, 'f47ac10b-58cc-4372-a567-0e02b2c3d479');
    assert.strictEqual(entries[0].uuid, 'F47AC10B-58CC-4372-A567-0E02B2C3D479');
    assert.strictEqual(entries[0].description, 'Auth service');
    assert.strictEqual(entries[1].description, 'Billing');
});

test('shape 2: wrapper object containing an array', () => {
    const root = { services: [{ id: '123e4567-e89b-12d3-a456-426614174000', description: 'Gateway' }] };
    const entries = extractEntries(root, OPTS);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].description, 'Gateway');
});

test('shape 2b: deeply nested wrappers', () => {
    const root = { a: { b: [{ c: [{ id: '123e4567-e89b-12d3-a456-426614174000', description: 'Deep' }] }] } };
    const entries = extractEntries(root, OPTS);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].description, 'Deep');
});

test('shape 3: direct uuid -> string map', () => {
    const root = { '2f4a9c1e-3b8d-4e5f-9a01-b2c3d4e5f607': 'DB connection lost' };
    const entries = extractEntries(root, OPTS);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].uuid, '2f4a9c1e-3b8d-4e5f-9a01-b2c3d4e5f607');
    assert.strictEqual(entries[0].description, 'DB connection lost');
});

test('shape 4: direct uuid -> object map using descriptionKey', () => {
    const root = { '2f4a9c1e-3b8d-4e5f-9a01-b2c3d4e5f607': { description: 'Timeout', severity: 'high' } };
    const entries = extractEntries(root, OPTS);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].description, 'Timeout');
});

test('custom keys with dot paths', () => {
    const root = [{ meta: { guid: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' }, details: { label: 'Dark mode' } }];
    const entries = extractEntries(root, {
        uuidKey: 'meta.guid',
        descriptionKey: 'details.label',
        sourcePath: '/fake.json',
    });
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].description, 'Dark mode');
});

test('non-UUID id values are ignored', () => {
    const root = [
        { id: 'not-a-uuid', description: 'Skip me' },
        { id: 42, description: 'Skip me too' },
        { description: 'No id at all' },
    ];
    const entries = extractEntries(root, OPTS);
    assert.strictEqual(entries.length, 0);
});

test('missing description yields empty string, not crash', () => {
    const root = [{ id: '123e4567-e89b-12d3-a456-426614174000' }];
    const entries = extractEntries(root, OPTS);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].description, '');
});

test('object descriptions are JSON-stringified', () => {
    const root = [{ id: '123e4567-e89b-12d3-a456-426614174000', description: { en: 'Hello', de: 'Hallo' } }];
    const entries = extractEntries(root, OPTS);
    assert.strictEqual(entries[0].description, JSON.stringify({ en: 'Hello', de: 'Hallo' }));
});

test('sourcePath is propagated to every entry', () => {
    const root = [{ id: '123e4567-e89b-12d3-a456-426614174000', description: 'X' }];
    const entries = extractEntries(root, { ...OPTS, sourcePath: '/tmp/my-defs.json' });
    assert.strictEqual(entries[0].sourcePath, '/tmp/my-defs.json');
});

/* --------------------- tests against the real samples --------------------- */

const samplesDir = path.join(__dirname, '..', 'samples');

test('sample: service-registry.json (wrapper + default keys)', () => {
    const root = JSON.parse(fs.readFileSync(path.join(samplesDir, 'service-registry.json'), 'utf8'));
    const entries = extractEntries(root, OPTS);
    assert.strictEqual(entries.length, 6);
    const auth = entries.find(e => e.normalizedUuid === 'f47ac10b-58cc-4372-a567-0e02b2c3d479');
    assert.ok(auth && auth.description.includes('Authentication'));
});

test('sample: error-codes.json (direct uuid -> string map)', () => {
    const root = JSON.parse(fs.readFileSync(path.join(samplesDir, 'error-codes.json'), 'utf8'));
    const entries = extractEntries(root, OPTS);
    assert.strictEqual(entries.length, 5);
});

test('sample: feature-flags.json (custom dot-path keys)', () => {
    const root = JSON.parse(fs.readFileSync(path.join(samplesDir, 'feature-flags.json'), 'utf8'));
    const entries = extractEntries(root, {
        uuidKey: 'meta.guid',
        descriptionKey: 'details.label',
        sourcePath: 'feature-flags.json',
    });
    assert.strictEqual(entries.length, 3);
    assert.ok(entries.some(e => e.description === 'Feature flag: dark-mode rollout'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

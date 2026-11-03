'use strict';

// Checks every question file for what the spaced-repetition queue relies on
// (docs/plans/spaced-repetition.md): `slug` equal to the file name (D1:
// order.json names questions by file name), and `created`, the question's
// creation time (D6: the backlog is in creation order). Run with `make test`.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const QUESTIONS_DIR = path.join(__dirname, 'questions');

// UTC ISO 8601 to the second, e.g. 2026-10-24T05:31:05Z. UTC only, so that
// comparing two as text gives the same order as comparing them as times
// (RFC 3339, section 5.1).
const CREATED_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

const files = fs.readdirSync(QUESTIONS_DIR).filter((name) => name.endsWith('.json')).sort();

test('there are question files to check', () => {
  assert.ok(files.length > 0);
});

for (const name of files) {
  /** The parts of a question file checked here. @type {{ slug?: unknown, created?: unknown }} */
  const question = JSON.parse(fs.readFileSync(path.join(QUESTIONS_DIR, name), 'utf8'));

  test(`${name}: slug is the file name without .json`, () => {
    assert.equal(question.slug, name.slice(0, -'.json'.length));
  });

  test(`${name}: created is a real UTC time, like 2026-10-24T05:31:05Z`, () => {
    assert.equal(typeof question.created, 'string', 'created is missing');
    const created = /** @type {string} */ (question.created);
    assert.match(created, CREATED_PATTERN);
    // A real date: 2026-02-30T00:00:00Z matches the pattern but isn't one,
    // and Date would roll it over to 2026-03-02.
    assert.equal(new Date(created).toISOString().replace('.000Z', 'Z'), created);
  });
}

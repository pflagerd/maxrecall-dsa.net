'use strict';

// Tests for learner.js (docs/plans/spaced-repetition.md, step 14). Run with
// `make test`.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { splitList, newLearnerFiles } = require('./learner');
const { effectiveProfile } = require('./profile');
const { parseQueueFiles } = require('./order');

const QUESTIONS = [
  { slug: 'hello-world', created: '2026-01-02T00:00:00Z', languages: ['javascript', 'python', 'cpp', 'java', 'd'] },
  { slug: 'two-sum', created: '2026-01-01T00:00:00Z', languages: ['python', 'java'] },
  { slug: 'cpp-only', created: '2026-01-03T00:00:00Z', languages: ['cpp'] },
];

test('splitList: spaces and commas separate; empty or unset is none', () => {
  assert.deepEqual(splitList('hello-world two-sum'), ['hello-world', 'two-sum']);
  assert.deepEqual(splitList(' python, java\tcpp '), ['python', 'java', 'cpp']);
  assert.deepEqual(splitList(''), []);
  assert.deepEqual(splitList(undefined), []);
});

test('a new learner: allowed languages, a chosen backlog, an empty queue (details 3 to 5)', () => {
  const files = newLearnerFiles(['python'], ['hello-world', 'two-sum'], QUESTIONS);
  assert.deepEqual(files.profile, { schemaVersion: 1, allowed: { languages: ['python'] }, backlog: 'chosen' });
  assert.deepEqual(files.order, { schemaVersion: 1, submitsSinceLastIntroduced: 0, queue: [] });
  assert.deepEqual(files.backlog, { schemaVersion: 1, backlog: [{ question: 'hello-world', language: 'python' }, { question: 'two-sum', language: 'python' }] });
  const profile = effectiveProfile(files.profile);
  assert.equal(profile.backlog, 'chosen');
  assert.deepEqual(profile.languages, ['python']);
  assert.doesNotThrow(() => parseQueueFiles(JSON.stringify(files.order), JSON.stringify(files.backlog)), 'the files are valid as the server reads them');
});

test('the questions keep the order given, not creation order; each in the languages given, in that order', () => {
  // two-sum was created before hello-world; java is listed before python.
  const files = newLearnerFiles(['java', 'python'], ['hello-world', 'two-sum'], QUESTIONS);
  assert.deepEqual(files.backlog.backlog.map((p) => `${p.question}/${p.language}`), ['hello-world/java', 'hello-world/python', 'two-sum/java', 'two-sum/python']);
  assert.equal(effectiveProfile(files.profile).defaultLanguage, 'java', 'the first language is the default');
});

test('the questions keep the order given even when it is neither alphabetical nor creation order', () => {
  // Alphabetical: a-first, hello-world, two-sum. Created: a-first, two-sum, hello-world.
  const questions = [...QUESTIONS, { slug: 'a-first', created: '2025-01-01T00:00:00Z', languages: ['python'] }];
  const files = newLearnerFiles(['python'], ['two-sum', 'a-first', 'hello-world'], questions);
  assert.deepEqual(files.backlog.backlog.map((p) => p.question), ['two-sum', 'a-first', 'hello-world']);
});

test('the languages given are copied, not shared with the caller', () => {
  const languages = ['python'];
  const files = newLearnerFiles(languages, ['hello-world'], QUESTIONS);
  languages.push('java');
  assert.deepEqual(files.profile.allowed?.languages, ['python']);
});

/** [what is wrong, languages, slugs, a pattern the message must match]. @type {[string, string[], string[], RegExp][]} */
const REFUSED = [
  ['no languages', [], ['hello-world'], /allowed\.languages/],
  ['an unknown language', ['python', 'cobol'], ['hello-world'], /"cobol"/],
  ['a language twice', ['python', 'python'], ['hello-world'], /twice/],
  ['no questions', ['python'], [], /at least one question/],
  ['an unknown question', ['python'], ['hello-world', 'nope'], /nope: no such question/],
  ['a question twice', ['python'], ['two-sum', 'two-sum'], /two-sum is named twice/],
  ['a question in none of the languages', ['python'], ['cpp-only'], /cpp-only has none of the languages turned on/],
];

for (const [what, languages, slugs, message] of REFUSED) {
  test(`refused: ${what}`, () => {
    assert.throws(() => newLearnerFiles(languages, slugs, QUESTIONS), message);
  });
}

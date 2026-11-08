'use strict';

// Checks every question file against the problem file format
// (question-files.js, checkQuestion; readme.html, "Problem file format"):
// what the server, the judge and the problem page rely on, including what
// the spaced-repetition queue does (docs/plans/spaced-repetition.md: `slug`
// equal to the file name, D1; `created`, D6). Then checks that each rule
// refuses a question that breaks it. Run with `make test`.
// docs/how-to-add-a-new-question.html says to run it after writing one.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { isQuestionFile, questionInfos, checkQuestion, findLearnedLoop, findRedundantLearned, findMissingLearnedLanguages } = require('./question-files');

const QUESTIONS_DIR = path.join(__dirname, 'questions');

const files = fs.readdirSync(QUESTIONS_DIR).filter(isQuestionFile).sort(); // not renames.json, the rename log
/** Every question's slug, for checking alreadyLearned's entries. @type {string[]} */
const slugs = files.map((name) => name.replace(/\.json$/, ''));

test('there are question files to check', () => {
  assert.ok(files.length > 0);
});

for (const name of files) {
  test(`${name} follows the problem file format`, () => {
    let question;
    try {
      question = JSON.parse(fs.readFileSync(path.join(QUESTIONS_DIR, name), 'utf8'));
    } catch (err) {
      assert.fail(`not valid JSON: ${/** @type {Error} */ (err).message}`);
    }
    assert.deepEqual(checkQuestion(question, name, slugs), []);
  });
}

test('no question builds on itself through alreadyLearned (no loop)', () => {
  /** @type {Record<string, string[]>} */
  const learnedBySlug = {};
  for (const name of files) {
    const question = JSON.parse(fs.readFileSync(path.join(QUESTIONS_DIR, name), 'utf8'));
    learnedBySlug[name.replace(/\.json$/, '')] = question.alreadyLearned || [];
  }
  assert.equal(findLearnedLoop(learnedBySlug), null);
  assert.deepEqual(findRedundantLearned(learnedBySlug), [], 'alreadyLearned lists only the questions each builds on directly');
});

test('each question a question builds on has all of its languages (a refresher opens in the clicked language, #88)', () => {
  /** @type {Record<string, { languages: string[], alreadyLearned?: string[] }>} */
  const questionsBySlug = {};
  for (const name of files) {
    const question = JSON.parse(fs.readFileSync(path.join(QUESTIONS_DIR, name), 'utf8'));
    questionsBySlug[name.replace(/\.json$/, '')] = { languages: Object.keys(question.starterCode), alreadyLearned: question.alreadyLearned };
  }
  assert.deepEqual(findMissingLearnedLanguages(questionsBySlug), []);
});

// --- docs/question-template.json -------------------------------------------
// The file to copy to start a question (docs/how-to-add-a-new-question.html,
// step 3): the Python parts of singly-linked-list-hello-world.json, with a
// placeholder created time and title. It isn't in questions/, since every
// file there is a question.

const TEMPLATE_FILE = path.join(__dirname, 'docs', 'question-template.json');
/** The template, parsed. @type {Record<string, any>} */
const template = JSON.parse(fs.readFileSync(TEMPLATE_FILE, 'utf8'));

test('questionInfos() passes alreadyLearned on, for order.js (#146), and leaves it out where there is none', () => {
  const bySlug = new Map(questionInfos().map((q) => [q.slug, q]));
  assert.deepEqual(bySlug.get('add-to-a-string')?.alreadyLearned, ['build-a-new-string']);
  assert.equal(bySlug.get('build-a-new-string')?.alreadyLearned, undefined);
});

test('docs/question-template.json follows the problem file format, so a copy starts valid', () => {
  assert.deepEqual(checkQuestion(template, 'question-template.json'), []);
});

test('no question still has the template\'s placeholder created time or title (copied but not changed)', () => {
  for (const name of files) {
    const question = JSON.parse(fs.readFileSync(path.join(QUESTIONS_DIR, name), 'utf8'));
    assert.notEqual(question.created, template.created, `${name}: created is still the template's, ${template.created}: use date -u +%Y-%m-%dT%H:%M:%SZ`);
    assert.notEqual(question.title, template.title, `${name}: title is still the template's`);
  }
});

// --- checkQuestion's rules, each broken on purpose ---------------------------

/**
 * A small valid function-mode question, in Python and C++, as a new object
 * each time.
 *
 * @returns {Record<string, any>} The question.
 */
function valid() {
  return {
    slug: 'sample',
    created: '2026-11-05T12:00:00Z',
    title: 'Sample',
    difficulty: 'Easy',
    topics: ['Linked List'],
    sources: [],
    description: { python: '<p>Do it.</p>', cpp: '<p>Do it.</p>' },
    examples: { python: [{ input: 'n = 1', output: '1' }], cpp: [{ input: 'n = 1', output: '1', explanation: 'One.' }] },
    constraints: { python: [], cpp: ['1 ≤ n'] },
    starterCode: { python: 'def f(n):\n    pass\n', cpp: 'int f(int n) {\n}\n' },
    functionName: { python: 'f', cpp: 'f' },
    signature: { cpp: { params: ['int'], returns: 'int' } },
    testCases: [{ args: [1], expected: 1, hidden: false }, { args: [2], expected: null, hidden: true }],
  };
}

/**
 * A small valid program-mode question, in Python only.
 *
 * @returns {Record<string, any>} The question.
 */
function validProgram() {
  return {
    slug: 'sample',
    created: '2026-11-05T12:00:00Z',
    title: 'Sample',
    difficulty: 'Hard',
    topics: [],
    sources: [],
    judgeMode: 'program',
    description: { python: '<p>Print it.</p>' },
    examples: { python: [] },
    constraints: { python: [] },
    starterCode: { python: '' },
    testCases: [{ input: '', expected: 'Hello' }],
  };
}

test('the valid samples pass, and so does one with learning text', () => {
  assert.deepEqual(checkQuestion(valid(), 'sample.json'), []);
  assert.deepEqual(checkQuestion(validProgram(), 'sample.json'), []);
  assert.deepEqual(checkQuestion({ ...valid(), learning: { python: '<p>Read this.</p>' } }, 'sample.json'), [], 'learning may cover only some languages');
  assert.deepEqual(checkQuestion({ ...valid(), alreadyLearned: ['two-sum'], learning: { python: LINK_TO_TWO_SUM, cpp: LINK_TO_TWO_SUM } }, 'sample.json', ['two-sum']), [], 'alreadyLearned with its links');
  assert.deepEqual(checkQuestion({ ...valid(), alreadyLearned: ['two-sum'] }, 'sample.json', ['two-sum']), [], 'alreadyLearned with no Learning tab to link from');
});

test('every difficulty passes, Fundamentals (below Easy, #93) included', () => {
  for (const difficulty of ['Fundamentals', 'Easy', 'Medium', 'Hard']) {
    assert.deepEqual(checkQuestion({ ...valid(), difficulty }, 'sample.json'), [], difficulty);
  }
});

test('alreadyLearned must name questions that exist, when the slugs are given', () => {
  const question = { ...valid(), alreadyLearned: ['no-such-question'] };
  assert.ok(checkQuestion(question, 'sample.json', ['two-sum']).some((p) => /alreadyLearned: there's no question "no-such-question"/.test(p)));
  assert.deepEqual(checkQuestion(question, 'sample.json'), [], 'without the slugs, existence isn\'t checked');
});

test('findLearnedLoop finds a loop, and only a loop', () => {
  assert.deepEqual(findLearnedLoop({ a: ['b'], b: ['c'], c: ['a'] }), ['a', 'b', 'c', 'a']);
  assert.deepEqual(findLearnedLoop({ a: ['a'] }), ['a', 'a']);
  assert.equal(findLearnedLoop({ a: ['b', 'c'], b: ['c'], c: [] }), null, 'two paths to one question are not a loop');
  assert.equal(findLearnedLoop({ a: ['missing'] }), null, 'an unknown question is checkQuestion\'s to report');
});

test('findMissingLearnedLanguages finds an earlier question lacking a language, and only that', () => {
  assert.deepEqual(findMissingLearnedLanguages({ a: { languages: ['python', 'java'], alreadyLearned: ['b'] }, b: { languages: ['python'] } }),
    ['a: alreadyLearned lists b, which has no java: a "Learned earlier" link opens it in the language it was clicked from, so add that language to b first']);
  assert.deepEqual(findMissingLearnedLanguages({ a: { languages: ['python', 'java', 'd'], alreadyLearned: ['b'] }, b: { languages: ['python'] } }),
    ['a: alreadyLearned lists b, which has no java, d: a "Learned earlier" link opens it in the language it was clicked from, so add those languages to b first']);
  assert.deepEqual(findMissingLearnedLanguages({ a: { languages: ['python'], alreadyLearned: ['b'] }, b: { languages: ['python', 'java'] } }), [], 'the earlier one may have more');
  assert.deepEqual(findMissingLearnedLanguages({ a: { languages: ['java'], alreadyLearned: ['gone'] } }), [], 'an entry naming no question is checkQuestion\'s to report');
  assert.deepEqual(findMissingLearnedLanguages({ a: { languages: ['java'] } }), [], 'no alreadyLearned');
});

test('findRedundantLearned finds an entry already reached through another', () => {
  assert.deepEqual(findRedundantLearned({ a: ['b', 'c'], b: ['c'], c: [] }), ['a: alreadyLearned lists c, which it already builds on through b: list only the questions it builds on directly']);
  assert.deepEqual(findRedundantLearned({ a: ['b', 'd'], b: ['c'], c: ['d'], d: [] }), ['a: alreadyLearned lists d, which it already builds on through b: list only the questions it builds on directly'], 'through more than one step');
  assert.deepEqual(findRedundantLearned({ a: ['b', 'c'], b: [], c: [] }), [], 'two direct prerequisites are fine');
  assert.deepEqual(findRedundantLearned({ a: ['b'], b: ['c'], c: [] }), [], 'a chain is fine');
});

/** A Learning tab's "Learned earlier" link to two-sum. @type {string} */
const LINK_TO_TWO_SUM = '<h3>Learned earlier</h3><ul><li><a href="/problem.html?slug=two-sum" target="_blank" rel="noopener">Two Sum</a>: adding.</li></ul>';

/** Given as a value to withChange(): delete the field instead. @type {symbol} */
const DELETE = Symbol('delete');

/**
 * A question with one field changed, or deleted: a broken copy for one
 * rule.
 *
 * @param {Record<string, any>} question - A question, from valid() or
 *   validProgram() (changed in place).
 * @param {string} fieldPath - The field, as dot-separated keys, with list
 *   positions as numbers, e.g. "testCases.0.hidden".
 * @param {unknown} value - Its new value, or DELETE to delete it.
 * @returns {Record<string, any>} The question.
 */
function withChange(question, fieldPath, value) {
  const keys = fieldPath.split('.');
  const last = /** @type {string} */ (keys.pop()); // a path has at least one key
  const parent = keys.reduce((o, k) => o[k], question);
  if (value === DELETE) delete parent[last];
  else parent[last] = value;
  return question;
}

/** [what is wrong, the question, a pattern one problem must match]. @type {[string, unknown, RegExp][]} */
const BROKEN = [
  ['not an object', [], /must be a JSON object/],
  ['a misspelt field', withChange(valid(), 'testcases', []), /unknown field "testcases" \(a typo\?/],
  ['slug not the file name', withChange(valid(), 'slug', 'other'), /slug must be the file name without \.json, "sample"/],
  ['created missing', withChange(valid(), 'created', DELETE), /created must be a UTC time/],
  ['created not UTC', withChange(valid(), 'created', '2026-11-05T12:00:00-08:00'), /created must be a UTC time/],
  ['created not a real date', withChange(valid(), 'created', '2026-02-30T00:00:00Z'), /isn't a real date/],
  ['no title', withChange(valid(), 'title', ' '), /title must be text/],
  ['an unknown difficulty', withChange(valid(), 'difficulty', 'easy'), /difficulty must be one of Fundamentals, Easy, Medium, Hard/],
  ['topics not a list', withChange(valid(), 'topics', 'Linked List'), /topics must be a list of names/],
  ['sources missing', withChange(valid(), 'sources', DELETE), /sources must be a list of names/],
  ['alreadyLearned not a list', withChange(valid(), 'alreadyLearned', 'two-sum'), /alreadyLearned must be a list of question slugs/],
  ['alreadyLearned empty (leave it out instead)', withChange(valid(), 'alreadyLearned', []), /alreadyLearned must be a list of question slugs/],
  ['alreadyLearned listing the question itself', withChange(valid(), 'alreadyLearned', ['sample']), /alreadyLearned can't list the question itself/],
  ['alreadyLearned listing one twice', withChange(valid(), 'alreadyLearned', ['two-sum', 'two-sum']), /alreadyLearned lists "two-sum" twice/],
  ['a Learning link alreadyLearned doesn\'t list', withChange(valid(), 'learning', { python: LINK_TO_TWO_SUM }), /learning\.python links to "two-sum".*alreadyLearned doesn't list it/],
  ['alreadyLearned with no link in one language', withChange(withChange(valid(), 'alreadyLearned', ['two-sum']), 'learning', { python: LINK_TO_TWO_SUM, cpp: '<p>No link.</p>' }), /learning\.cpp: no "Learned earlier" link to "two-sum"/],
  ['an unknown judgeMode', withChange(valid(), 'judgeMode', 'functions'), /judgeMode must be "function" or "program"/],
  ['no starterCode', withChange(valid(), 'starterCode', {}), /starterCode must give the starting code for at least one language/],
  ['an unknown language', withChange(valid(), 'starterCode.Python', 'x'), /starterCode\.Python: not a language the judge knows/],
  ['starter code not text', withChange(valid(), 'starterCode.python', ['def f(n):']), /starterCode\.python must be text/],
  ['a language with no description', withChange(valid(), 'description.cpp', DELETE), /description\.cpp is missing: starterCode has cpp/],
  ['an empty description', withChange(valid(), 'description.python', ''), /description\.python must be HTML text/],
  ['a description for a language with no starter code', withChange(valid(), 'description.java', '<p>x</p>'), /description\.java: starterCode has no java/],
  ['examples missing entirely (the page would throw)', withChange(valid(), 'examples', DELETE), /examples must be an object keyed by language/],
  ['an example without output', withChange(valid(), 'examples.python.0.output', DELETE), /examples\.python must be a list of \{ input, output, explanation\? \}/],
  ['constraints not a list', withChange(valid(), 'constraints.cpp', '1 ≤ n'), /constraints\.cpp must be a list of text/],
  ['learning for a language with no starter code', withChange(valid(), 'learning', { d: '<p>x</p>' }), /learning\.d: starterCode has no d/],
  ['a language with no functionName (every Run would be a NameError)', withChange(valid(), 'functionName.python', DELETE), /functionName\.python is missing: starterCode has python/],
  ['cpp with no signature', withChange(valid(), 'signature', DELETE), /signature\.cpp must be \{ params: \[types\], returns: type \}/],
  ['a signature without returns', withChange(valid(), 'signature.cpp.returns', DELETE), /signature\.cpp must be/],
  ['functionName in program mode', withChange(validProgram(), 'functionName', { python: 'main' }), /functionName is only for judgeMode "function"/],
  ['no test cases', withChange(valid(), 'testCases', []), /testCases must be a list of at least one test case/],
  ['a test case without args', withChange(valid(), 'testCases.0.args', DELETE), /testCases\[0\]\.args must be the list of arguments/],
  ['a test case without expected', withChange(valid(), 'testCases.1.expected', DELETE), /testCases\[1\]\.expected is missing \(null is allowed/],
  ['a misspelt test case field', withChange(valid(), 'testCases.0.hiden', true), /testCases\[0\]: unknown "hiden"/],
  ['hidden not true or false', withChange(valid(), 'testCases.0.hidden', 'yes'), /testCases\[0\]\.hidden must be true or false/],
  ['every test case hidden', withChange(valid(), 'testCases.0.hidden', true), /at least one must be visible/],
  ['a program test case without input', withChange(validProgram(), 'testCases.0.input', DELETE), /testCases\[0\]\.input must be the program's standard input/],
  ['a program test case expecting a number', withChange(validProgram(), 'testCases.0.expected', 5), /testCases\[0\]\.expected must be the expected standard output, as text/],
];

for (const [what, question, pattern] of BROKEN) {
  test(`refused, naming the field: ${what}`, () => {
    const problems = checkQuestion(question, 'sample.json');
    assert.ok(problems.some((p) => pattern.test(p)), `expected a problem matching ${pattern}, got ${JSON.stringify(problems)}`);
  });
}

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
const { isQuestionFile, questionInfos, checkQuestion, findLearnedLoop, findRedundantLearned, kindOf, languagesOf, fillInMaxLength } = require('./question-files');

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

/**
 * A small valid fill-in question (#160), in Python only, as a new object
 * each time.
 *
 * @returns {Record<string, any>} The question.
 */
function validFillIn() {
  return {
    slug: 'sample',
    created: '2026-11-08T12:00:00Z',
    title: 'Sample',
    difficulty: 'Fundamentals',
    topics: ['String'],
    sources: [],
    kind: 'fill-in',
    description: { python: '<p>Fill in the blank.</p>' },
    template: { python: 'print("A quote (___) here.")\n' },
    blank: '___',
  };
}

test('a valid fill-in question passes, with or without maxLength', () => {
  assert.deepEqual(checkQuestion(validFillIn(), 'sample.json'), []);
  assert.deepEqual(checkQuestion({ ...validFillIn(), maxLength: 100 }, 'sample.json'), [], 'maxLength at the cap');
  assert.deepEqual(checkQuestion({ ...validFillIn(), learning: { python: '<p>Read this.</p>' } }, 'sample.json'), []);
  assert.deepEqual(checkQuestion({ ...valid(), kind: 'code' }, 'sample.json'), [], 'kind "code" may be written out');
});

test('kindOf: absent means "code"; languagesOf follows the kind; fillInMaxLength defaults to 10', () => {
  assert.equal(kindOf(valid()), 'code');
  assert.equal(kindOf(validFillIn()), 'fill-in');
  assert.deepEqual(languagesOf(valid()), ['python', 'cpp']);
  assert.deepEqual(languagesOf(validFillIn()), ['python']);
  assert.deepEqual(languagesOf({ kind: 'quiz' }), [], 'an unknown kind has no languages');
  assert.equal(fillInMaxLength(validFillIn()), 10);
  assert.equal(fillInMaxLength({ ...validFillIn(), maxLength: 3 }), 3);
});

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
  // Kinds and fill-in questions (#160).
  ['an unknown kind', withChange(valid(), 'kind', 'quiz'), /kind must be "code" or "fill-in"/],
  ['a fill-in question with test cases', withChange(validFillIn(), 'testCases', []), /testCases is only for kind "code", not "fill-in"/],
  ['a fill-in question with examples', withChange(validFillIn(), 'examples', { python: [] }), /examples is only for kind "code"/],
  ['a code question with a template', withChange(valid(), 'template', { python: 'x' }), /template is only for kind "fill-in", not "code"/],
  ['a fill-in question with no template', withChange(validFillIn(), 'template', DELETE), /template must give the code, with the blank, for at least one language/],
  ['a fill-in template in an unknown language', withChange(validFillIn(), 'template.Python', 'x ___'), /template\.Python: not a language the judge knows/],
  ['a fill-in description for a language with no template', withChange(validFillIn(), 'description.cpp', '<p>x</p>'), /description\.cpp: template has no cpp/],
  ['a fill-in question with no blank', withChange(validFillIn(), 'blank', DELETE), /blank must be the text that marks the blank/],
  ['a blank marker on two lines', withChange(validFillIn(), 'blank', '__\n_'), /blank must be the text that marks the blank in each template, on one line/],
  ['a template without the blank', withChange(validFillIn(), 'template.python', 'print("no blank")'), /template\.python must contain the blank, "___", exactly once \(it has it 0 times\)/],
  ['a template with the blank twice', withChange(validFillIn(), 'template.python', 'print("___ ___")'), /exactly once \(it has it 2 times\)/],
  ['maxLength over the cap (#160, Q15)', withChange(validFillIn(), 'maxLength', 101), /maxLength must be a whole number from 1 to 100/],
  ['maxLength 0', withChange(validFillIn(), 'maxLength', 0), /maxLength must be a whole number from 1 to 100/],
  ['maxLength not a whole number', withChange(validFillIn(), 'maxLength', 2.5), /maxLength must be a whole number/],
];

for (const [what, question, pattern] of BROKEN) {
  test(`refused, naming the field: ${what}`, () => {
    const problems = checkQuestion(question, 'sample.json');
    assert.ok(problems.some((p) => pattern.test(p)), `expected a problem matching ${pattern}, got ${JSON.stringify(problems)}`);
  });
}

// --- Fill-in judging (#160): judge/fill-in.js, and every judge file --------
//
// Judges are server code (docs/roles/questions.md, "Judge files"). These
// tests check judge/fill-in.js on judges written to a temporary folder,
// then check every real questions/<slug>.judge.js: each of its own cases
// run in a worker thread that's stopped when its time runs out (#172;
// node:test's own timeout can't stop a synchronous loop), and R1, by
// reading its source with TypeScript's parser.

const os = require('os');
const { Worker } = require('node:worker_threads');
const ts = require('typescript6');
const { judgeFillIn, checkVerdict, JudgeFailedError, MESSAGE_MAX_LENGTH, HINTS_MAX } = require('./judge/fill-in');

/** How long one judge case may take before it counts as never returning. @type {number} */
const JUDGE_CASE_TIMEOUT_MS = 1000;

/**
 * A temporary folder of judge files for these tests, removed when the
 * test process exits.
 *
 * @param {Record<string, string>} judges - Each judge's slug and source.
 * @returns {string} The folder.
 */
function judgeFolder(judges) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maxrecall-judges-'));
  for (const [slug, source] of Object.entries(judges)) fs.writeFileSync(path.join(dir, `${slug}.judge.js`), source);
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const QUOTE_JUDGE = `module.exports = {
  judge(blank) {
    if (blank === "'") return { pass: true };
    if (blank === "\\\\'") return { pass: false, message: 'Your answer would technically work, but is not what we asked for.', hints: ['No backslash needed.'] };
    return { pass: false, message: 'Not a single quote.' };
  },
  cases: [{ blank: "'", pass: true }, { blank: "\\\\'", pass: false, messageIncludes: 'technically' }],
};
`;
const FIXTURES = judgeFolder({
  quote: QUOTE_JUDGE,
  throws: 'module.exports = { judge() { throw new Error("oops"); } };',
  async: 'module.exports = { judge: async () => ({ pass: true }) };',
  shape: 'module.exports = { judge: () => ({ pass: "yes" }) };',
  getter: 'module.exports = { judge: () => ({ get pass() { throw new Error("boom"); } }) };',
  long: `module.exports = { judge: () => ({ pass: false, message: "x".repeat(${MESSAGE_MAX_LENGTH + 1}) }) };`,
  nojudge: 'module.exports = {};',
  loops: 'module.exports = { judge() { for (;;) {} }, cases: [{ blank: "x", pass: true }] };',
});

/**
 * A fill-in question object, as routes.js would load it, for these tests.
 *
 * @param {string} slug - Its slug, the name of a judge in FIXTURES.
 * @returns {{ slug: string, kind: string }} The question.
 */
const fillIn = (slug) => ({ slug, kind: 'fill-in' });

test('judgeFillIn: a pass is Accepted; a fail is Wrong Answer with the judge\'s message and hints; never passed or total', () => {
  assert.deepEqual(judgeFillIn(fillIn('quote'), { blank: "'" }, 'python', FIXTURES), { status: 'Accepted' });
  const fail = judgeFillIn(fillIn('quote'), { blank: "\\'" }, 'python', FIXTURES);
  assert.equal(fail.status, 'Wrong Answer');
  assert.match(fail.message || '', /technically work/);
  assert.deepEqual(fail.hints, ['No backslash needed.']);
  assert.ok(!('passed' in fail) && !('total' in fail));
});

test('judgeFillIn: a judge that throws, is async, returns the wrong shape, a getter that throws, or too long a message, or is missing, is JUDGE_FAILED (Q9a)', (t) => {
  t.mock.method(console, 'error', () => {}); // judgeFillIn logs each failure; keep the test output clean
  for (const slug of ['throws', 'async', 'shape', 'getter', 'long', 'nojudge', 'no-such-judge']) {
    assert.throws(() => judgeFillIn(fillIn(slug), { blank: 'x' }, 'python', FIXTURES), (err) => err instanceof JudgeFailedError && err.code === 'JUDGE_FAILED', slug);
  }
  assert.throws(() => judgeFillIn(fillIn('../quote'), { blank: 'x' }, 'python', path.join(FIXTURES, 'sub')), /JUDGE_FAILED|outside/, 'a slug can\'t lead outside the folder (R2)');
});

test('judgeFillIn: an answer the route should have refused, or a code question, is the caller\'s mistake (TypeError)', () => {
  for (const answer of [{ blank: 'x', extra: 1 }, { blank: ['x'] }, { blank: 'x'.repeat(11) }, {}, null]) {
    assert.throws(() => judgeFillIn(fillIn('quote'), /** @type {any} */ (answer), 'python', FIXTURES), TypeError, JSON.stringify(answer));
  }
  assert.doesNotThrow(() => judgeFillIn({ ...fillIn('quote'), maxLength: 11 }, { blank: 'x'.repeat(11) }, 'python', FIXTURES), 'maxLength raises the limit');
  assert.throws(() => judgeFillIn({ slug: 'quote' }, { blank: 'x' }, 'python', FIXTURES), TypeError, 'a question with no kind is a code question');
});

test('checkVerdict: only { pass, message?, hints? }, within the caps (#171)', () => {
  assert.equal(checkVerdict({ pass: true }), null);
  assert.equal(checkVerdict({ pass: false, message: 'No.', hints: ['Try again.'] }), null);
  for (const bad of [null, [], 'yes', { pass: 1 }, { pass: true, extra: 1 }, { pass: false, message: 5 }, { pass: false, hints: 'x' }, { pass: false, hints: Array(HINTS_MAX + 1).fill('x') }, { pass: false, hints: [5] }, Promise.resolve({ pass: true })]) {
    assert.notEqual(checkVerdict(bad), null, String(JSON.stringify(bad)));
  }
});

/**
 * Runs one of a judge file's own cases in a worker thread, stopped after
 * `timeoutMs` (#172): node:test's own timeout can't stop a synchronous
 * loop, since its timer never gets the thread.
 *
 * @param {string} file - The judge file's path.
 * @param {number} index - Which of its cases to run; -1 to count them.
 * @param {number} timeoutMs - How long it may take.
 * @returns {Promise<{ timedOut: true } | { error: string } | { count: number } | { problem: string | null }>}
 *   What happened: it timed out, threw, counted its cases, or ran one
 *   (problem: null if the verdict matched the case).
 */
function runJudgeCase(file, index, timeoutMs) {
  const code = `
    const { parentPort, workerData } = require('node:worker_threads');
    const { checkVerdict } = require(workerData.fillIn);
    const { judge, cases } = require(workerData.file);
    if (workerData.index < 0) { parentPort.postMessage({ count: Array.isArray(cases) ? cases.length : 0 }); }
    else {
      const c = cases[workerData.index];
      const verdict = judge(c.blank, { language: c.language || 'python' });
      const wrong = checkVerdict(verdict);
      let problem = wrong && ('the verdict is ' + wrong);
      if (!problem && verdict.pass !== c.pass) problem = 'pass is ' + verdict.pass + ', the case expects ' + c.pass;
      if (!problem && c.messageIncludes && !(verdict.message || '').includes(c.messageIncludes)) problem = 'the message doesn\\'t include ' + JSON.stringify(c.messageIncludes);
      parentPort.postMessage({ problem });
    }`;
  return new Promise(
    /**
     * Starts the worker, and settles with the first of its answer, its
     * error, or the time running out.
     *
     * @param {(outcome: { timedOut: true } | { error: string } | { count: number } | { problem: string | null }) => void} resolve -
     *   Settles the promise.
     * @returns {void}
     */
    (resolve) => {
    const worker = new Worker(code, { eval: true, workerData: { file, index, fillIn: path.join(__dirname, 'judge', 'fill-in.js') } });
    const timer = setTimeout(
      /**
       * The time ran out: stop the worker, whatever the judge is doing.
       *
       * @returns {void}
       */
      () => {
        worker.terminate();
        resolve({ timedOut: true });
      },
      timeoutMs,
    );
    worker.on(
      'message',
      /**
       * The case's outcome.
       *
       * @param {{ count: number } | { problem: string | null }} msg - What the worker found.
       * @returns {void}
       */
      (msg) => {
        clearTimeout(timer);
        worker.terminate();
        resolve(msg);
      },
    );
    worker.on(
      'error',
      /**
       * The judge, or its file, threw.
       *
       * @param {Error} err - What it threw.
       * @returns {void}
       */
      (err) => {
        clearTimeout(timer);
        resolve({ error: err.message });
      },
    );
  },
  );
}

test('the worker harness: a judge\'s cases pass, and a judge that never returns is stopped, not left to hang make test', async () => {
  const quote = path.join(FIXTURES, 'quote.judge.js');
  assert.deepEqual(await runJudgeCase(quote, -1, JUDGE_CASE_TIMEOUT_MS), { count: 2 });
  assert.deepEqual(await runJudgeCase(quote, 0, JUDGE_CASE_TIMEOUT_MS), { problem: null });
  assert.deepEqual(await runJudgeCase(quote, 1, JUDGE_CASE_TIMEOUT_MS), { problem: null });
  const started = Date.now();
  assert.deepEqual(await runJudgeCase(path.join(FIXTURES, 'loops.judge.js'), 0, 200), { timedOut: true });
  assert.ok(Date.now() - started < 2000, 'stopped near its time limit');
});

/** The judge/ helpers a judge file may require (R1), by the path it requires them with; none yet. @type {readonly string[]} */
const JUDGE_HELPERS = Object.freeze([]);
/**
 * What a judge file may not name (R1): the four the rule lists, and (the
 * architect's R3 review of #181) `global`, which reaches process as
 * global.process, and the timers, which run code after judging returns.
 * @type {readonly string[]}
 */
const JUDGE_FORBIDDEN_NAMES = Object.freeze(['process', 'globalThis', 'eval', 'Function', 'global', 'setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask']);
/**
 * What a judge file may not use as a property name either (the
 * architect's R3 review of #181): module.require("fs") loads anything;
 * ({}).constructor.constructor builds a Function from text;
 * module.constructor._load loads anything; __proto__ reaches the same.
 * @type {readonly string[]}
 */
const JUDGE_FORBIDDEN_PROPERTIES = Object.freeze(['require', 'constructor', '__proto__']);

/**
 * What a judge file breaks of R1, read with TypeScript's parser: a
 * require of anything but JUDGE_HELPERS, require used other than as such a
 * call, a dynamic import(), a name in JUDGE_FORBIDDEN_NAMES, or a property
 * in JUDGE_FORBIDDEN_PROPERTIES (x.constructor, x["constructor"]). Not a
 * sandbox (a determined author can get round it): it makes a judge that
 * reaches past its blank a failing test, not something a reviewer must
 * spot.
 *
 * @param {string} source - The judge file's text.
 * @returns {string[]} The problems, each with its line; empty if none.
 */
function judgeSourceProblems(source) {
  const file = ts.createSourceFile('judge.js', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  /** @type {string[]} */
  const problems = [];
  /**
   * Where a node is, for a message.
   *
   * @param {import('typescript6').Node} node - The node.
   * @returns {string} "line N".
   */
  const at = (node) => `line ${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
  /**
   * Checks a node, then its children.
   *
   * @param {import('typescript6').Node} node - The node.
   * @returns {void}
   */
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) problems.push(`${at(node)}: import() is not allowed`);
    if (ts.isPropertyAccessExpression(node) && JUDGE_FORBIDDEN_PROPERTIES.includes(node.name.text)) problems.push(`${at(node)}: .${node.name.text} is not allowed`);
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && JUDGE_FORBIDDEN_PROPERTIES.includes(node.argumentExpression.text)) problems.push(`${at(node)}: [${JSON.stringify(node.argumentExpression.text)}] is not allowed`);
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const isPropertyName = (ts.isPropertyAccessExpression(parent) && parent.name === node) || (ts.isPropertyAssignment(parent) && parent.name === node) || (ts.isMethodDeclaration(parent) && parent.name === node);
      if (!isPropertyName && JUDGE_FORBIDDEN_NAMES.includes(node.text)) problems.push(`${at(node)}: ${node.text} is not allowed`);
      if (!isPropertyName && node.text === 'require') {
        const call = ts.isCallExpression(parent) && parent.expression === node ? parent : null;
        const target = call && call.arguments.length === 1 && ts.isStringLiteral(call.arguments[0]) ? call.arguments[0].text : null;
        if (target === null) problems.push(`${at(node)}: require may only be called with a helper's path`);
        else if (!JUDGE_HELPERS.includes(target)) problems.push(`${at(node)}: require(${JSON.stringify(target)}) is not an allowed judge/ helper`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return problems;
}

test('R1: a judge file may use none of process, globalThis, eval, Function, import(), or require but of a helper', () => {
  assert.deepEqual(judgeSourceProblems(QUOTE_JUDGE), []);
  assert.deepEqual(judgeSourceProblems('module.exports = { judge: (b) => ({ pass: b.process === 1 }) };'), [], 'a property named process is fine');
  for (const [bad, pattern] of [
    ['const fs = require("fs");', /require\("fs"\) is not an allowed/],
    ['const r = require; r("fs");', /require may only be called/],
    ['import("fs");', /import\(\) is not allowed/],
    ['process.exit(1);', /process is not allowed/],
    ['globalThis.x = 1;', /globalThis is not allowed/],
    ['eval("1");', /eval is not allowed/],
    ['new Function("return 1")();', /Function is not allowed/],
    // The architect's R3 review of #181: ways round the names above.
    ['global.process.exit(1);', /global is not allowed/],
    ['module.require("fs");', /\.require is not allowed/],
    ['({}).constructor.constructor("return 1")();', /\.constructor is not allowed/],
    ['module.constructor._load("child_process");', /\.constructor is not allowed/],
    ['setTimeout(() => {}, 1);', /setTimeout is not allowed/],
    ['({})["constructor"];', /\["constructor"\] is not allowed/],
    ['({}).__proto__;', /\.__proto__ is not allowed/],
  ]) {
    assert.ok(judgeSourceProblems(String(bad)).some((p) => /** @type {RegExp} */ (pattern).test(p)), String(bad));
  }
});

/** Every judge file in questions/, by slug. @type {string[]} */
const judgeSlugs = fs.readdirSync(QUESTIONS_DIR).filter((f) => f.endsWith('.judge.js')).map((f) => f.slice(0, -'.judge.js'.length)).sort();

test('every judge file belongs to a fill-in question, and every fill-in question has one', () => {
  for (const slug of judgeSlugs) {
    assert.ok(files.includes(`${slug}.json`), `questions/${slug}.judge.js has no questions/${slug}.json`);
    assert.equal(kindOf(JSON.parse(fs.readFileSync(path.join(QUESTIONS_DIR, `${slug}.json`), 'utf8'))), 'fill-in', `${slug}.json isn't a fill-in question`);
  }
  for (const name of files) {
    const question = JSON.parse(fs.readFileSync(path.join(QUESTIONS_DIR, name), 'utf8'));
    if (kindOf(question) === 'fill-in') assert.ok(judgeSlugs.includes(question.slug), `${name} is a fill-in question with no questions/${question.slug}.judge.js`);
  }
});

for (const slug of judgeSlugs) {
  const file = path.join(QUESTIONS_DIR, `${slug}.judge.js`);
  test(`${slug}.judge.js follows R1`, () => {
    assert.deepEqual(judgeSourceProblems(fs.readFileSync(file, 'utf8')), []);
  });
  test(`${slug}.judge.js passes its own cases, each in a worker within ${JUDGE_CASE_TIMEOUT_MS} ms`, async () => {
    const counted = await runJudgeCase(file, -1, JUDGE_CASE_TIMEOUT_MS);
    assert.ok('count' in counted && counted.count > 0, `it must export cases: ${JSON.stringify(counted)}`);
    for (let i = 0; i < counted.count; i += 1) assert.deepEqual(await runJudgeCase(file, i, JUDGE_CASE_TIMEOUT_MS), { problem: null }, `case ${i}`);
  });
}

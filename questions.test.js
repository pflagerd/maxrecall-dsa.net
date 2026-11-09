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
const { execFileSync } = require('child_process');
// These tests check the repository's own question bank, whatever
// MAXRECALL_QUESTIONS_DIR says in the shell that ran make test (#160): drop
// it before question-files.js reads it. It's this test process's copy of
// the environment only.
delete process.env.MAXRECALL_QUESTIONS_DIR;
const { REPO_QUESTIONS_DIR, isQuestionFile, questionInfos, checkQuestion, findLearnedLoop, findRedundantLearned, kindOf, languagesOf, fillInTheBlankMaxLength } = require('./question-files');

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

/**
 * Runs a script in a new node process with MAXRECALL_QUESTIONS_DIR set, as
 * users' routes.test.js starts its server.
 *
 * @param {string} dir - The folder to name in MAXRECALL_QUESTIONS_DIR.
 * @param {string[]} args - node's arguments: a script, or -e and code.
 * @returns {string} What it printed.
 */
function runWithQuestionsDir(dir, args) {
  return execFileSync(process.execPath, args, { cwd: __dirname, env: { ...process.env, MAXRECALL_QUESTIONS_DIR: dir }, encoding: 'utf8' });
}

test('MAXRECALL_QUESTIONS_DIR moves the questions folder the server reads (#160); unset, it is questions/', () => {
  assert.equal(REPO_QUESTIONS_DIR, path.join(__dirname, 'questions'));
  assert.equal(require('./question-files').QUESTIONS_DIR, REPO_QUESTIONS_DIR, 'make test reads the repository\'s bank, whatever the shell set');
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'maxrecall-questions-'));
  try {
    fs.copyFileSync(path.join(REPO_QUESTIONS_DIR, 'hello-world.json'), path.join(dir, 'hello-world.json'));
    const out = JSON.parse(runWithQuestionsDir(path.relative(__dirname, dir), ['-e', `
      const q = require('./question-files');
      const j = require('./judge/fill-in-the-blank');
      console.log(JSON.stringify({ dir: q.QUESTIONS_DIR, repo: q.REPO_QUESTIONS_DIR, slugs: q.questionInfos().map((i) => i.slug), judge: j.judgeFilePath('x') }));`]));
    assert.equal(out.dir, dir, 'a relative path is resolved');
    assert.equal(out.repo, REPO_QUESTIONS_DIR);
    assert.deepEqual(out.slugs, ['hello-world'], 'questionInfos() reads only that folder');
    assert.equal(out.judge, path.join(dir, 'x.judge.js'), 'judge files are loaded from it too (R2, relative to it)');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('make rename-question and make delete-question refuse while MAXRECALL_QUESTIONS_DIR is set: they change only the repository\'s bank', () => {
  for (const command of ['delete', 'rename']) {
    assert.throws(() => runWithQuestionsDir(require('os').tmpdir(), ['scripts/question-admin.js', command]), (err) => /MAXRECALL_QUESTIONS_DIR/.test(String(/** @type {{ stderr?: string }} */ (err).stderr)), command);
  }
});

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
 * A small valid fill-in-the-blank question (#160), in Python only, as a new object
 * each time.
 *
 * @returns {Record<string, any>} The question.
 */
function validFillInTheBlank() {
  return {
    slug: 'sample',
    created: '2026-11-08T12:00:00Z',
    title: 'Sample',
    difficulty: 'Fundamentals',
    topics: ['String'],
    sources: [],
    kind: 'fill-in-the-blank',
    description: { python: '<p>Fill in the blank.</p>' },
    template: { python: 'print("A quote (___) here.")\n' },
    blank: '___',
  };
}

test('a valid fill-in-the-blank question passes, with or without maxLength', () => {
  assert.deepEqual(checkQuestion(validFillInTheBlank(), 'sample.json'), []);
  assert.deepEqual(checkQuestion({ ...validFillInTheBlank(), maxLength: 100 }, 'sample.json'), [], 'maxLength at the cap');
  assert.deepEqual(checkQuestion({ ...validFillInTheBlank(), learning: { python: '<p>Read this.</p>' } }, 'sample.json'), []);
  assert.deepEqual(checkQuestion({ ...valid(), kind: 'code' }, 'sample.json'), [], 'kind "code" may be written out');
});

test('kindOf: absent means "code"; languagesOf follows the kind; fillInTheBlankMaxLength defaults to 10', () => {
  assert.equal(kindOf(valid()), 'code');
  assert.equal(kindOf(validFillInTheBlank()), 'fill-in-the-blank');
  assert.deepEqual(languagesOf(valid()), ['python', 'cpp']);
  assert.deepEqual(languagesOf(validFillInTheBlank()), ['python']);
  assert.deepEqual(languagesOf({ kind: 'quiz' }), [], 'an unknown kind has no languages');
  assert.equal(fillInTheBlankMaxLength(validFillInTheBlank()), 10);
  assert.equal(fillInTheBlankMaxLength({ ...validFillInTheBlank(), maxLength: 3 }), 3);
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
  // Kinds and fill-in-the-blank questions (#160).
  ['an unknown kind', withChange(valid(), 'kind', 'quiz'), /kind must be "code" or "fill-in-the-blank"/],
  ['a fill-in-the-blank question with test cases', withChange(validFillInTheBlank(), 'testCases', []), /testCases is only for kind "code", not "fill-in-the-blank"/],
  ['a fill-in-the-blank question with examples', withChange(validFillInTheBlank(), 'examples', { python: [] }), /examples is only for kind "code"/],
  ['a code question with a template', withChange(valid(), 'template', { python: 'x' }), /template is only for kind "fill-in-the-blank", not "code"/],
  ['a fill-in-the-blank question with no template', withChange(validFillInTheBlank(), 'template', DELETE), /template must give the code, with the blank, for at least one language/],
  ['a fill-in-the-blank template in an unknown language', withChange(validFillInTheBlank(), 'template.Python', 'x ___'), /template\.Python: not a language the judge knows/],
  ['a fill-in-the-blank description for a language with no template', withChange(validFillInTheBlank(), 'description.cpp', '<p>x</p>'), /description\.cpp: template has no cpp/],
  ['a fill-in-the-blank question with no blank', withChange(validFillInTheBlank(), 'blank', DELETE), /blank must be the text that marks the blank/],
  ['a blank marker on two lines', withChange(validFillInTheBlank(), 'blank', '__\n_'), /blank must be the text that marks the blank in each template, on one line/],
  ['a template without the blank', withChange(validFillInTheBlank(), 'template.python', 'print("no blank")'), /template\.python must contain the blank, "___", exactly once \(it has it 0 times\)/],
  ['a template with the blank twice', withChange(validFillInTheBlank(), 'template.python', 'print("___ ___")'), /exactly once \(it has it 2 times\)/],
  ['maxLength over the cap (#160, Q15)', withChange(validFillInTheBlank(), 'maxLength', 101), /maxLength must be a whole number from 1 to 100/],
  ['maxLength 0', withChange(validFillInTheBlank(), 'maxLength', 0), /maxLength must be a whole number from 1 to 100/],
  ['maxLength not a whole number', withChange(validFillInTheBlank(), 'maxLength', 2.5), /maxLength must be a whole number/],
];

for (const [what, question, pattern] of BROKEN) {
  test(`refused, naming the field: ${what}`, () => {
    const problems = checkQuestion(question, 'sample.json');
    assert.ok(problems.some((p) => pattern.test(p)), `expected a problem matching ${pattern}, got ${JSON.stringify(problems)}`);
  });
}

// --- Fill-in-the-blank judging (#160): judge/fill-in-the-blank.js, and every judge file --------
//
// Judges are server code (docs/roles/questions.md, "Judge files"). These
// tests check judge/fill-in-the-blank.js on judges written to a temporary folder,
// then check every real questions/<slug>.judge.js: each of its own cases
// run in a worker thread that's stopped when its time runs out (#172;
// node:test's own timeout can't stop a synchronous loop), and R1, by
// reading its source with TypeScript's parser.

const os = require('os');
const { Worker } = require('node:worker_threads');
const ts = require('typescript6');
const { judgeFillInTheBlank, judgeSha256Of, checkVerdict, JudgeFailedError, MESSAGE_MAX_LENGTH, HINTS_MAX } = require('./judge/fill-in-the-blank');

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

const QUOTE_JUDGE = `'use strict';
module.exports = {
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
 * A fill-in-the-blank question object, as routes.js would load it, for these tests.
 *
 * @param {string} slug - Its slug, the name of a judge in FIXTURES.
 * @returns {{ slug: string, kind: string }} The question.
 */
const fillInTheBlank = (slug) => ({ slug, kind: 'fill-in-the-blank' });

test('judgeFillInTheBlank: a pass is Accepted; a fail is Wrong Answer with the judge\'s message and hints; never passed or total', () => {
  assert.deepEqual(judgeFillInTheBlank(fillInTheBlank('quote'), { blank: "'" }, 'python', FIXTURES), { status: 'Accepted' });
  const fail = judgeFillInTheBlank(fillInTheBlank('quote'), { blank: "\\'" }, 'python', FIXTURES);
  assert.equal(fail.status, 'Wrong Answer');
  assert.match(fail.message || '', /technically work/);
  assert.deepEqual(fail.hints, ['No backslash needed.']);
  assert.ok(!('passed' in fail) && !('total' in fail));
});

test('judgeFillInTheBlank: a judge that throws, is async, returns the wrong shape, a getter that throws, or too long a message, or is missing, is JUDGE_FAILED (Q9a)', (t) => {
  t.mock.method(console, 'error', () => {}); // judgeFillInTheBlank logs each failure; keep the test output clean
  for (const slug of ['throws', 'async', 'shape', 'getter', 'long', 'nojudge', 'no-such-judge']) {
    assert.throws(() => judgeFillInTheBlank(fillInTheBlank(slug), { blank: 'x' }, 'python', FIXTURES), (err) => err instanceof JudgeFailedError && err.code === 'JUDGE_FAILED', slug);
  }
  assert.throws(() => judgeFillInTheBlank(fillInTheBlank('../quote'), { blank: 'x' }, 'python', path.join(FIXTURES, 'sub')), /JUDGE_FAILED|outside/, 'a slug can\'t lead outside the folder (R2)');
});

test('judgeFillInTheBlank: an answer the route should have refused, or a code question, is the caller\'s mistake (TypeError)', () => {
  for (const answer of [{ blank: 'x', extra: 1 }, { blank: ['x'] }, { blank: 'x'.repeat(11) }, {}, null]) {
    assert.throws(() => judgeFillInTheBlank(fillInTheBlank('quote'), /** @type {any} */ (answer), 'python', FIXTURES), TypeError, JSON.stringify(answer));
  }
  assert.doesNotThrow(() => judgeFillInTheBlank({ ...fillInTheBlank('quote'), maxLength: 11 }, { blank: 'x'.repeat(11) }, 'python', FIXTURES), 'maxLength raises the limit');
  assert.throws(() => judgeFillInTheBlank({ slug: 'quote' }, { blank: 'x' }, 'python', FIXTURES), TypeError, 'a question with no kind is a code question');
});

test('judgeSha256Of: the judge file\'s SHA-256 as it was loaded, the code that judges until a restart (users\' D6; owner, 2026-11-09, b)', () => {
  const v1 = "'use strict';\nmodule.exports = { judge: (blank) => ({ pass: blank === 'a' }) };\n";
  const dir = judgeFolder({ hashed: v1 });
  const question = { slug: 'hashed', kind: 'fill-in-the-blank' };
  const expected = require('crypto').createHash('sha256').update(v1).digest('hex');
  assert.equal(judgeSha256Of(question, dir), expected, 'the SHA-256 of the file\'s bytes, in hex');
  assert.deepEqual(judgeFillInTheBlank(question, { blank: 'a' }, 'python', dir), { status: 'Accepted' }, 'the result carries no hash: routes.js sends it to the browser as it is');
  // Changed under a running server: the old code still judges, and the hash
  // still says so.
  fs.writeFileSync(path.join(dir, 'hashed.judge.js'), v1.replace("'a'", "'b'"));
  assert.deepEqual(judgeFillInTheBlank(question, { blank: 'a' }, 'python', dir), { status: 'Accepted' }, 'the code loaded first still judges');
  assert.equal(judgeSha256Of(question, dir), expected, 'and the hash is still the code\'s that ran');
  assert.throws(() => judgeSha256Of({ slug: 'no-such-judge', kind: 'fill-in-the-blank' }, dir), (err) => err instanceof JudgeFailedError && err.code === 'JUDGE_FAILED');
  assert.throws(() => judgeSha256Of({ slug: 'hashed' }, dir), TypeError, 'a code question has no judge');
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
    const { checkVerdict } = require(workerData.fillInTheBlank);
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
    const worker = new Worker(code, { eval: true, workerData: { file, index, fillInTheBlank: path.join(__dirname, 'judge', 'fill-in-the-blank.js') } });
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
 * What a judge file may not name (R1): the four the rule lists; `global`,
 * which reaches process as global.process, and the timers, which run code
 * after judging returns (the architect's R3 review of #181); and
 * `Reflect`, `Proxy` and `arguments` (owner, 2026-11-09, B: Reflect.get
 * reads a property whose name was built at run time).
 * @type {readonly string[]}
 */
const JUDGE_FORBIDDEN_NAMES = Object.freeze(['process', 'globalThis', 'eval', 'Function', 'global', 'setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask', 'Reflect', 'Proxy', 'arguments']);
/**
 * What a judge file may not use as a property name, wherever one is
 * written: x.name, x["name"], an object literal's key, or a destructuring
 * pattern's ({ name: y } or { name }). module.require("fs") loads
 * anything; ({}).constructor.constructor builds a Function from text;
 * __proto__, caller and callee reach objects past the judge's own; and the
 * descriptor and prototype functions (and their legacy __lookupGetter__
 * family) read or change a property by a name built at run time (the
 * architect's R3 reviews of #181; owner, 2026-11-09, B).
 * @type {readonly string[]}
 */
const JUDGE_FORBIDDEN_PROPERTIES = Object.freeze([
  'require', 'constructor', '__proto__', 'caller', 'callee',
  'getOwnPropertyDescriptor', 'getOwnPropertyDescriptors', 'getPrototypeOf', 'setPrototypeOf', 'defineProperty', 'defineProperties',
  '__lookupGetter__', '__lookupSetter__', '__defineGetter__', '__defineSetter__',
  // owner, 2026-11-09, (a): no judge needs it, and it's the door to
  // changing a built-in for the whole server (String.prototype.startsWith).
  'prototype',
]);
/**
 * The built-ins a judge file may refer to without declaring them (R1's
 * allow-list; owner, 2026-11-09, (a)). Anything else not declared in the
 * judge file is refused, so a name nobody thought of (fetch, Promise,
 * WebSocket, console, Buffer, exports, …) is refused too. Each may only be
 * called (`String(x)`, `new Set()`) or have a property read
 * (`Math.max(a, b)`, `JSON.parse(s)`), never be used as a value
 * (`const M = Math`, `arr.map(Number)`): an alias would let a write to it
 * pass as a write to the judge's own variable.
 * @type {readonly string[]}
 */
const JUDGE_ALLOWED_BUILTINS = Object.freeze(['String', 'Number', 'Boolean', 'Math', 'JSON', 'Array', 'Set', 'Map', 'RegExp']);
/**
 * The allowed built-ins that may only be called or constructed, never have
 * a property read (the architect's R3 review of #191): RegExp's legacy
 * statics (RegExp.input, lastMatch, $1–$9, leftContext, rightContext) hold
 * the last match made anywhere in the process, and auth.js tests session
 * tokens with a regular expression (auth.js:503). Of the allowed
 * built-ins, only RegExp has such properties (checked on Node 22.23.4: the
 * others' own properties are all functions or fixed constants).
 * @type {readonly string[]}
 */
const JUDGE_CALL_ONLY_BUILTINS = Object.freeze(['RegExp']);
/** Built-in values a judge file may use anywhere, as they're not objects (R1's allow-list). @type {readonly string[]} */
const JUDGE_ALLOWED_VALUES = Object.freeze(['undefined', 'NaN', 'Infinity']);

/**
 * What a judge file breaks of R1, read with TypeScript's parser. Closed by
 * kind (owner, 2026-11-09, B), each rule shutting a way round the others:
 * - `'use strict'` as the first statement, written exactly so (a string
 *   with an escape in it is no directive), and no `this`: in strict mode a
 *   function called on its own has `this` undefined, not the global object;
 * - a require of anything but JUDGE_HELPERS, and require used other than
 *   as such a call; no dynamic import();
 * - `module` only as `module.exports`;
 * - no name in JUDGE_FORBIDDEN_NAMES, and no property in
 *   JUDGE_FORBIDDEN_PROPERTIES wherever a property's name is written;
 * - a computed key (x[k], { [k]: v }, { [k]: y } = x) only as a string or
 *   number literal, so every property's name can be read here.
 * Then an allow-list of names (owner, 2026-11-09, (a)), for the ways round
 * that need no forbidden name (a built-in changed, fetch, code run later):
 * - every name refers to something the judge file declares (found with
 *   TypeScript's checker, which knows each name's scope), or is in
 *   JUDGE_ALLOWED_BUILTINS, only called or read from (only called, for
 *   JUDGE_CALL_ONLY_BUILTINS), or in JUDGE_ALLOWED_VALUES;
 * - every write (=, +=, ++, --, delete, a destructuring or for-in/of
 *   target) is to a variable the judge file declares, or to
 *   module.exports itself: no property writes at all (owner, 2026-11-09,
 *   option (i)), since a built-in function read into the judge's own
 *   variable (`const h = ({}).hasOwnProperty`) could otherwise have its
 *   `.call` replaced for the whole server;
 * - no async, await, generators or yield: each runs code after the judge
 *   returns.
 * Not a sandbox (a determined author can get round it): it makes a judge
 * that reaches past its blank a failing test, not something a reviewer
 * must spot. Review (R3) is the guard against a deliberate evasion.
 *
 * @param {string} source - The judge file's text.
 * @returns {string[]} The problems, each with its line; empty if none.
 */
function judgeSourceProblems(source) {
  const fileName = '/judge.js';
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  // A program of this one file, with no lib: TypeScript's checker then
  // resolves each name to its declaration in the file, by scope, and a
  // built-in or any other global resolves to nothing.
  /** @type {import('typescript6').CompilerOptions} */
  const options = { allowJs: true, noLib: true, noResolve: true, types: [], target: ts.ScriptTarget.ES2022 };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name) => (name === fileName ? file : undefined);
  host.fileExists = (name) => name === fileName;
  host.readFile = (name) => (name === fileName ? source : undefined);
  const checker = ts.createProgram([fileName], options, host).getTypeChecker();
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
   * A key's text, if it's written as a string or number literal.
   *
   * @param {import('typescript6').Node} node - The key: what's inside x[...] or { [...]: v }.
   * @returns {string | null} Its text; null for anything else.
   */
  const literalKey = (node) => (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node) ? node.text : null);
  /**
   * Checks a property name as written in a property position: x.name, an
   * object literal's key, a destructuring pattern's key. A computed key
   * must be a literal; any key must not be in JUDGE_FORBIDDEN_PROPERTIES.
   *
   * @param {import('typescript6').Node} name - The name node.
   * @returns {void}
   */
  const checkPropertyName = (name) => {
    /** @type {string | null} */
    let text = null;
    if (ts.isComputedPropertyName(name)) {
      text = literalKey(name.expression);
      if (text === null) problems.push(`${at(name)}: a computed key must be a string or number literal`);
    } else if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
      text = name.text;
    }
    if (text !== null && JUDGE_FORBIDDEN_PROPERTIES.includes(text)) problems.push(`${at(name)}: the property ${JSON.stringify(text)} is not allowed`);
  };
  /**
   * Whether an identifier is written as a property's name, not as a
   * reference to a variable: x.name, { name: v }, a method's or accessor's
   * name, or the key in { name: y } = x.
   *
   * @param {import('typescript6').Identifier} node - The identifier.
   * @returns {boolean} True if it names a property.
   */
  const isPropertyName = (node) => {
    const parent = node.parent;
    return (ts.isPropertyAccessExpression(parent) && parent.name === node)
      || ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent) || ts.isPropertyDeclaration(parent)) && parent.name === node)
      || (ts.isBindingElement(parent) && parent.propertyName === node);
  };
  /**
   * Whether a name is declared in the judge file, in a scope it's used in:
   * a variable, function, class, parameter or catch binding of its own.
   *
   * @param {import('typescript6').Identifier} node - A name, used as a reference.
   * @returns {boolean} True if it resolves to the judge file's own declaration.
   */
  const isDeclaredHere = (node) => {
    const parent = node.parent;
    const symbol = ts.isShorthandPropertyAssignment(parent) && parent.name === node ? checker.getShorthandAssignmentValueSymbol(parent) : checker.getSymbolAtLocation(node);
    // Only a real declaration counts. In a JavaScript file TypeScript also
    // treats an assignment like `Math.max = …` as declaring Math (its
    // "expando" assignments), which would let any write declare its own
    // target.
    return !!symbol && (symbol.declarations || []).some((d) => d.getSourceFile() === file && (ts.isVariableDeclaration(d) || ts.isParameter(d) || ts.isFunctionDeclaration(d) || ts.isFunctionExpression(d) || ts.isClassDeclaration(d) || ts.isClassExpression(d) || ts.isBindingElement(d)));
  };
  /**
   * What a write changes: the targets of an assignment's left side,
   * looking inside a destructuring pattern ([a, b.c] = …, ({ x: d.e } = …)).
   *
   * @param {import('typescript6').Expression} target - The left side, or an element of it.
   * @returns {import('typescript6').Expression[]} Each place written to.
   */
  const writeTargets = (target) => {
    while (ts.isParenthesizedExpression(target)) target = target.expression;
    if (ts.isArrayLiteralExpression(target)) return target.elements.flatMap((e) => (ts.isOmittedExpression(e) ? [] : writeTargets(ts.isSpreadElement(e) ? e.expression : e)));
    if (ts.isObjectLiteralExpression(target)) {
      return target.properties.flatMap(
        /**
         * One property of a destructuring pattern: where it writes.
         *
         * @param {import('typescript6').ObjectLiteralElementLike} p - The property.
         * @returns {import('typescript6').Expression[]} Each place written to.
         */
        (p) => {
          if (ts.isPropertyAssignment(p)) return writeTargets(p.initializer);
          if (ts.isShorthandPropertyAssignment(p)) return [p.name];
          if (ts.isSpreadAssignment(p)) return writeTargets(p.expression);
          return [];
        },
      );
    }
    if (ts.isBinaryExpression(target) && target.operatorToken.kind === ts.SyntaxKind.EqualsToken) return writeTargets(target.left); // a default: [a = 1] = …
    return [target];
  };
  /**
   * Checks one place a write changes: only a variable the judge file
   * declares, or `module.exports` itself, exactly (owner, 2026-11-09,
   * option (i)). Any property write is a problem, the judge's own objects'
   * included: a built-in function read into the judge's own variable
   * (`const h = ({}).hasOwnProperty; h.call = …`, or through
   * `module.exports = h; module.exports.call = …`) would otherwise change
   * for the whole server. Method calls on the judge's own objects
   * (`list.push(x)`, `map.set(k, v)`) aren't writes and stay allowed.
   *
   * @param {import('typescript6').Expression} target - The place written to.
   * @returns {void}
   */
  const checkWriteTarget = (target) => {
    let place = target;
    while (ts.isParenthesizedExpression(place)) place = place.expression;
    if (ts.isIdentifier(place) && isDeclaredHere(place)) return;
    if (ts.isPropertyAccessExpression(place) && ts.isIdentifier(place.expression) && place.expression.text === 'module' && place.name.text === 'exports') return;
    problems.push(`${at(target)}: a write must be to a variable the judge file declares, or to module.exports itself (no property writes), not ${target.getText(file)}`);
  };

  const first = file.statements[0];
  const strict = first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && ["'use strict'", '"use strict"'].includes(first.expression.getText(file));
  if (!strict) problems.push("line 1: a judge file must begin with 'use strict'");

  /**
   * Checks a node, then its children.
   *
   * @param {import('typescript6').Node} node - The node.
   * @returns {void}
   */
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.ThisKeyword) problems.push(`${at(node)}: this is not allowed`);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) problems.push(`${at(node)}: import() is not allowed`);
    if (ts.isPropertyAccessExpression(node)) checkPropertyName(node.name);
    if (ts.isElementAccessExpression(node)) {
      const text = literalKey(node.argumentExpression);
      if (text === null) problems.push(`${at(node)}: x[k] needs a string or number literal for k`);
      else if (JUDGE_FORBIDDEN_PROPERTIES.includes(text)) problems.push(`${at(node)}: the property ${JSON.stringify(text)} is not allowed`);
    }
    if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node) || ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) || ts.isPropertyDeclaration(node)) checkPropertyName(node.name);
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) checkPropertyName(node.propertyName || node.name);
    if (ts.isFunctionLike(node) && (ts.getCombinedModifierFlags(/** @type {import('typescript6').Declaration} */ (node)) & ts.ModifierFlags.Async)) problems.push(`${at(node)}: async is not allowed`);
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node)) && node.asteriskToken) problems.push(`${at(node)}: a generator is not allowed`);
    if (ts.isAwaitExpression(node) || (ts.isForOfStatement(node) && node.awaitModifier)) problems.push(`${at(node)}: await is not allowed`);
    if (ts.isYieldExpression(node)) problems.push(`${at(node)}: yield is not allowed`);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) writeTargets(node.left).forEach(checkWriteTarget);
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) checkWriteTarget(node.operand);
    if (ts.isDeleteExpression(node)) checkWriteTarget(node.expression);
    if ((ts.isForInStatement(node) || ts.isForOfStatement(node)) && !ts.isVariableDeclarationList(node.initializer)) writeTargets(node.initializer).forEach(checkWriteTarget);
    const isLabel = ts.isIdentifier(node) && (ts.isLabeledStatement(node.parent) || ts.isBreakOrContinueStatement(node.parent)) && /** @type {{ label?: import('typescript6').Node }} */ (node.parent).label === node;
    if (ts.isIdentifier(node) && !isPropertyName(node) && !isLabel) {
      const parent = node.parent;
      if (JUDGE_FORBIDDEN_NAMES.includes(node.text)) problems.push(`${at(node)}: ${node.text} is not allowed`);
      else if (node.text === 'module') {
        if (!(ts.isPropertyAccessExpression(parent) && parent.expression === node && parent.name.text === 'exports')) problems.push(`${at(node)}: module may be used only as module.exports`);
      } else if (node.text === 'require') {
        const call = ts.isCallExpression(parent) && parent.expression === node ? parent : null;
        const target = call && call.arguments.length === 1 && ts.isStringLiteral(call.arguments[0]) ? call.arguments[0].text : null;
        if (target === null) problems.push(`${at(node)}: require may only be called with a helper's path`);
        else if (!JUDGE_HELPERS.includes(target)) problems.push(`${at(node)}: require(${JSON.stringify(target)}) is not an allowed judge/ helper`);
      } else if (!isDeclaredHere(node) && !JUDGE_ALLOWED_VALUES.includes(node.text)) {
        if (!JUDGE_ALLOWED_BUILTINS.includes(node.text)) problems.push(`${at(node)}: ${node.text} is neither declared in the judge file nor an allowed built-in`);
        else if (JUDGE_CALL_ONLY_BUILTINS.includes(node.text)) {
          if (!((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === node)) problems.push(`${at(node)}: ${node.text} may only be called or constructed, not have a property read or be used as a value`);
        } else if (!((ts.isCallExpression(parent) || ts.isNewExpression(parent) || ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === node)) problems.push(`${at(node)}: ${node.text} may only be called or have a property read, not be used as a value`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return problems;
}

test('R1: a judge file uses only its own names and allowed built-ins, writes only its own, and none of the ways round found so far', () => {
  assert.deepEqual(judgeSourceProblems(QUOTE_JUDGE), []);
  /**
   * A judge file that keeps every rule, judging with `body`.
   *
   * @param {string} body - The judge function's expression body.
   * @returns {string} The file's text.
   */
  const ok = (body) =>`'use strict';\nmodule.exports = { judge: (b) => ${body} };`;
  assert.deepEqual(judgeSourceProblems(ok('({ pass: b.process === 1 })')), [], 'a property named process is fine');
  assert.deepEqual(judgeSourceProblems(ok('({ pass: b[0] === "x" && b["length"] === 1 && b.at(-1) === "x" })')), [], 'literal keys are fine');
  assert.deepEqual(judgeSourceProblems(`"use strict";\nconst { length } = "x";\nmodule.exports = { judge: () => ({ pass: length === 1 }) };`), [], 'double quotes, and a harmless destructuring');
  // What a judge may do under the allow-list (owner, 2026-11-09, (a)).
  const allowed = `'use strict';
const QUOTES = new Set(["'", '\u2019']);
const hints = [];
let count = 0;
function hintFor(blank, language) {
  const fetch = blank.trim();
  count += 1;
  outer: for (const c of fetch) { if (c === '\\\\') break outer; }
  return String(fetch.length) + Math.max(1, Number(language === 'python')) + JSON.stringify([undefined, NaN, Infinity]) + Array.isArray(hints) + RegExp('x').test(fetch) + new RegExp('y').test(fetch) + /z/.test(fetch);
}
const state = { seen: 0, list: [0] };
count += state.seen;
state.list.push(1);
[count] = [0];
({ seen: count } = { seen: 2 });
try { hints.push(hintFor('x', 'python')); } catch (e) { hints.push(String(e)); }
module.exports = { judge(blank, { language }) { return { pass: QUOTES.has(blank) && language !== '' }; }, cases: [] };
const extra = Boolean(new Map().size);
`;
  assert.deepEqual(judgeSourceProblems(allowed), [], 'its own names (a local named fetch included), the allowed built-ins called or read from, writes to its own variables and to module.exports, method calls on its own objects, a label');
  for (const [bad, pattern] of [
    ['const fs = require("fs");', /require\("fs"\) is not an allowed/],
    ['const r = require; r("fs");', /require may only be called/],
    ['import("fs");', /import\(\) is not allowed/],
    ['process.exit(1);', /process is not allowed/],
    ['globalThis.x = 1;', /globalThis is not allowed/],
    ['eval("1");', /eval is not allowed/],
    ['new Function("return 1")();', /Function is not allowed/],
    // The architect's first R3 review of #181: ways round the names above.
    ['global.process.exit(1);', /global is not allowed/],
    ['module.require("fs");', /"require" is not allowed|module may be used only/],
    ['({}).constructor.constructor("return 1")();', /"constructor" is not allowed/],
    ['module.constructor._load("child_process");', /"constructor" is not allowed/],
    ['setTimeout(() => {}, 1);', /setTimeout is not allowed/],
    ['({})["constructor"];', /"constructor" is not allowed/],
    ['({}).__proto__;', /"__proto__" is not allowed/],
    // The architect's second and third R3 reviews of #181 (2026-11-08 and
    // 2026-11-09), the six closed by kind (owner, 2026-11-09, B):
    // 1. sloppy-mode this is the global object;
    ['(function () { return this; })().process;', /this is not allowed/],
    // 2. a property name built at run time;
    ['module["req" + "uire"]("fs");', /x\[k\] needs a string or number literal|module may be used only/],
    // 3. Reflect reads one by any name;
    ['Reflect.get(module, "req" + "uire")("child_process");', /Reflect is not allowed/],
    // 4. destructuring names a property without x.name;
    ['const { constructor: F } = () => 0; F("return process")();', /"constructor" is not allowed/],
    // 5. a descriptor of module's prototype;
    ['const k = "req" + "uire"; Object.getOwnPropertyDescriptor(Object.getPrototypeOf(module), k).value.call(module, "fs");', /"getOwnPropertyDescriptor" is not allowed/],
    // 6. a constructor's name built at run time.
    ['(() => 0)["constr" + "uctor"]("return process")();', /x\[k\] needs a string or number literal/],
    // Each rule on its own, so no one of them stands only behind another.
    ['module.exports = {};', /must begin with 'use strict'/],
    ['\'use\\x20strict\';', /must begin with 'use strict'/],
    ['const m = module;', /module may be used only as module\.exports/],
    ['const k = "constructor"; const { [k]: F } = () => 0;', /a computed key must be a string or number literal/],
    ['const o = { ["constructor"]: 1 };', /"constructor" is not allowed/],
    ['const { constructor } = () => 0;', /"constructor" is not allowed/],
    ['({ constructor: F } = () => 0);', /"constructor" is not allowed/],
    ['const g = Object.getPrototypeOf;', /"getPrototypeOf" is not allowed/],
    ['const { getOwnPropertyDescriptor: d } = Object;', /"getOwnPropertyDescriptor" is not allowed/],
    ['Object.defineProperty({}, "x", {});', /"defineProperty" is not allowed/],
    ['({}).__lookupGetter__("__proto__");', /"__lookupGetter__" is not allowed/],
    ['function f() { return f.caller; }', /"caller" is not allowed/],
    ['new Proxy({}, {});', /Proxy is not allowed/],
    ['function f() { return arguments; }', /arguments is not allowed/],
    ['const s = "abc"; const i = 0; s[i];', /x\[k\] needs a string or number literal/],
    // The architect's R3 re-review of #181 at 313d85f: three kinds with no
    // forbidden name, closed by the allow-list (owner, 2026-11-09, (a)).
    // 1. changing a built-in for the whole server;
    ['String.prototype.startsWith = () => true;', /"prototype" is not allowed/],
    ['Math.max = () => 0;', /a write must be to a variable the judge file declares/],
    // 2. the network;
    ['fetch("http://127.0.0.1:3001/");', /fetch is neither declared in the judge file nor an allowed built-in/],
    // 3. code run after judging returns, with a name or with none.
    ['Promise.resolve().then(() => 0);', /Promise is neither declared/],
    ['const later = async () => { await 0; };', /async is not allowed/],
    // An alias of a built-in (questions 2, 2026-11-09): run, it set
    // Math.max(1, 2) to 0 for the whole process; M is the judge's own
    // variable, so the write rule alone wouldn't see it.
    ['const M = Math; M.max = () => 0;', /Math may only be called or have a property read/],
    // Each rule on its own.
    ['console.log("x");', /console is neither declared/],
    ['exports.judge = () => ({ pass: true });', /exports is neither declared/],
    ['function f(fetch) { return fetch; }\nfetch("x");', /line 3: fetch is neither declared/],
    ['const o = { fetch };', /fetch is neither declared/],
    ['[1].map(Number);', /Number may only be called/],
    ['const x = [] instanceof Array;', /Array may only be called/],
    ['JSON.parse = () => ({});', /a write must be to a variable/],
    ['delete Math.PI;', /a write must be to a variable/],
    ['Math.random.x = 1;', /a write must be to a variable/],
    ['Math.x++;', /a write must be to a variable/],
    ['[Math.x] = [1];', /a write must be to a variable/],
    ['({ a: JSON.x } = { a: 1 });', /a write must be to a variable/],
    ['for (Math.x of [1]) {}', /a write must be to a variable/],
    ['[].x = 1;', /a write must be to a variable/],
    ['undefinedThing = 1;', /a write must be to a variable|undefinedThing is neither declared/],
    // No property writes at all (owner, 2026-11-09, option (i)): the
    // residual of #191's R3 re-review. Each was run on Node 22.23.4 and
    // changed the built-in method for the whole process.
    ['const h = ({}).hasOwnProperty; h.call = () => true;', /no property writes/],
    ['module.exports = ({}).hasOwnProperty; module.exports.call = () => true;', /no property writes/],
    ['const p = [].push; p.apply = () => 0;', /no property writes/],
    ['const f = Math.max; f.call = () => 99;', /no property writes/],
    // And so on the judge's own objects too, by any form of write.
    ['const o = {}; o.x = 1;', /no property writes/],
    ['const o = {}; o["x"] = 1;', /no property writes/],
    ['const o = { n: 0 }; o.n += 1;', /no property writes/],
    ['const o = { n: 0 }; o.n++;', /no property writes/],
    ['const o = { x: 1 }; delete o.x;', /no property writes/],
    ['const o = {}; ({ a: o.x } = { a: 1 });', /no property writes/],
    ['const o = {}; [o.x] = [1];', /no property writes/],
    ['module.exports = {}; module.exports.judge = () => ({ pass: true });', /no property writes/],
    ['async function f() {}', /async is not allowed/],
    ['const o = { async m() {} };', /async is not allowed/],
    ['function* g() { yield 1; }', /a generator is not allowed/],
    ['function* g() { yield 1; }', /yield is not allowed/],
    ['const o = { *m() {} };', /a generator is not allowed/],
    // The architect's R3 review of #191: RegExp's legacy statics hold the
    // last match made anywhere in the process (run: a judge's message
    // carried a token tested before it).
    ['const m = RegExp.input;', /RegExp may only be called or constructed/],
    ['const m = RegExp.lastMatch + RegExp.$1;', /RegExp may only be called or constructed/],
    ['const m = RegExp["leftContext"];', /RegExp may only be called or constructed/],
    ['const R = RegExp;', /RegExp may only be called or constructed/],
  ]) {
    const source = String(bad).startsWith("'use") || String(bad).startsWith('module.exports') ? String(bad) : `'use strict';\n${bad}`;
    assert.ok(judgeSourceProblems(source).some((p) => /** @type {RegExp} */ (pattern).test(p)), `${source}\n  gave ${JSON.stringify(judgeSourceProblems(source))}`);
  }
});

/** Every judge file in questions/, by slug. @type {string[]} */
const judgeSlugs = fs.readdirSync(QUESTIONS_DIR).filter((f) => f.endsWith('.judge.js')).map((f) => f.slice(0, -'.judge.js'.length)).sort();

test('every judge file belongs to a fill-in-the-blank question, and every fill-in-the-blank question has one', () => {
  for (const slug of judgeSlugs) {
    assert.ok(files.includes(`${slug}.json`), `questions/${slug}.judge.js has no questions/${slug}.json`);
    assert.equal(kindOf(JSON.parse(fs.readFileSync(path.join(QUESTIONS_DIR, `${slug}.json`), 'utf8'))), 'fill-in-the-blank', `${slug}.json isn't a fill-in-the-blank question`);
  }
  for (const name of files) {
    const question = JSON.parse(fs.readFileSync(path.join(QUESTIONS_DIR, name), 'utf8'));
    if (kindOf(question) === 'fill-in-the-blank') assert.ok(judgeSlugs.includes(question.slug), `${name} is a fill-in-the-blank question with no questions/${question.slug}.judge.js`);
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

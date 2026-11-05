'use strict';

// Reading questions/: which files are questions, what order.js needs to
// know about each, and the rename log (spaced-repetition plan, D5). Shared
// by server.js and the consistency check (scripts/consistency-check.js), so
// both see the same questions.

const fs = require('fs');
const path = require('path');

/** Where the question files are. @type {string} */
const QUESTIONS_DIR = path.join(__dirname, 'questions');

/**
 * The rename log's file name, in questions/ (D5): { "old-name": "new-name" }.
 * Written by step 11's make rename-question; it isn't a question.
 *
 * @type {string}
 */
const RENAMES_FILE = 'renames.json';

/**
 * Whether a file in questions/ is a question: a .json file other than the
 * rename log.
 *
 * @param {string} name - The file's name, e.g. "two-sum.json".
 * @returns {boolean} True for a question file.
 */
function isQuestionFile(name) {
  return name.endsWith('.json') && name !== RENAMES_FILE;
}

/**
 * The fields of a question file read here (readme.html, "Problem file
 * format"); the rest are left alone.
 *
 * @typedef {object} QuestionFile
 * @property {string} title
 * @property {string} difficulty - "Easy", "Medium" or "Hard".
 * @property {string[]} topics
 * @property {string[]} sources
 * @property {string} created - UTC ISO 8601 (step 3).
 * @property {Record<string, string>} starterCode - By language.
 */

/**
 * What order.js needs to know about a question, and what GET /api/next and
 * GET /api/queue show of it.
 *
 * @typedef {import('./order').QuestionInfo & Pick<QuestionFile, 'title' | 'difficulty' | 'topics' | 'sources'>} QuestionListing
 */

/**
 * What order.js needs to know about every question in questions/ (moved
 * here from server.js in step 10, unchanged).
 *
 * @returns {QuestionListing[]} One per question file: its file name without
 *   .json (D1), created, its starterCode's languages, title, difficulty,
 *   topics and sources.
 * @throws {Error} If questions/ can't be read, or a file isn't valid JSON
 *   (the message then names the file).
 */
function questionInfos() {
  return fs
    .readdirSync(QUESTIONS_DIR)
    .filter(isQuestionFile)
    .map(
      /**
       * Reads what's needed from one question file.
       *
       * @param {string} f - The file's name in questions/.
       * @returns {QuestionListing} Its slug, created, languages, title,
       *   difficulty, topics and sources.
       * @throws {Error} "questions/<f>: ..." if it can't be read or parsed.
       */
      (f) => {
        /** @type {QuestionFile} */
        let problem;
        try {
          problem = JSON.parse(fs.readFileSync(path.join(QUESTIONS_DIR, f), 'utf8'));
        } catch (err) {
          throw new Error(`questions/${f}: ${/** @type {Error} */ (err).message}`);
        }
        const { title, difficulty, topics, sources } = problem;
        return { slug: f.slice(0, -'.json'.length), created: problem.created, languages: Object.keys(problem.starterCode), title, difficulty, topics, sources };
      },
    );
}

/**
 * questions/renames.json's text (D5), for the consistency check to parse.
 *
 * @returns {string | undefined} Its contents, or undefined if there's no
 *   such file (no renames yet: step 11 creates it).
 * @throws {Error} If the file exists but can't be read.
 */
function readRenamesText() {
  try {
    return fs.readFileSync(path.join(QUESTIONS_DIR, RENAMES_FILE), 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return undefined;
    throw err;
  }
}

/** A question file's fields (readme.html, "Problem file format"). @type {readonly string[]} */
const QUESTION_FIELDS = Object.freeze(['slug', 'created', 'title', 'difficulty', 'topics', 'sources', 'judgeMode', 'learning', 'description', 'examples', 'constraints', 'starterCode', 'functionName', 'signature', 'testCases']);
/** The difficulties the list shows. @type {readonly string[]} */
const DIFFICULTIES = Object.freeze(['Easy', 'Medium', 'Hard']);
/** The languages whose judge harness needs a signature (judge/runner.js). @type {readonly string[]} */
const TYPED_LANGUAGES = Object.freeze(['cpp', 'java', 'd']);
// UTC ISO 8601 to the second, e.g. 2026-10-24T05:31:05Z. UTC only, so that
// comparing two as text gives the same order as comparing them as times
// (RFC 3339, section 5.1).
const CREATED_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/**
 * Whether value is a plain object (not null, not an array).
 *
 * @param {unknown} value - The value.
 * @returns {value is Record<string, any>} True for a plain object.
 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * What's wrong with a question file, as make test checks it
 * (questions.test.js; docs/how-to-add-a-new-question.html): what the
 * server, the judge and the problem page rely on. Each check says which
 * field, so a new question's mistakes are found before a learner meets
 * them (for example, a language in starterCode with no functionName makes
 * every Run in it fail with NameError). Not checked: that the test cases'
 * expected answers are right (the owner's Test button, issue #58), and
 * that topics and sources are in labels.json (names it doesn't list just
 * keep the default colours).
 *
 * @param {unknown} question - The file's contents, parsed.
 * @param {string} fileName - Its name in questions/, e.g. "two-sum.json".
 * @returns {string[]} The problems, each naming the field; empty if none.
 */
function checkQuestion(question, fileName) {
  if (!isPlainObject(question)) return ['must be a JSON object'];
  /** @type {string[]} */
  const problems = [];
  const q = question;
  const unknown = Object.keys(q).filter((key) => !QUESTION_FIELDS.includes(key));
  if (unknown.length) problems.push(`unknown ${unknown.length === 1 ? 'field' : 'fields'} ${unknown.map((k) => JSON.stringify(k)).join(', ')} (a typo? the fields are ${QUESTION_FIELDS.join(', ')})`);

  if (q.slug !== fileName.replace(/\.json$/, '')) problems.push(`slug must be the file name without .json, ${JSON.stringify(fileName.replace(/\.json$/, ''))}`);
  if (typeof q.created !== 'string' || !CREATED_PATTERN.test(q.created)) {
    problems.push('created must be a UTC time to the second, like "2026-10-24T05:31:05Z"');
  } else if (new Date(q.created).toISOString().replace('.000Z', 'Z') !== q.created) {
    // 2026-02-30T00:00:00Z matches the pattern but isn't a date: Date rolls it over.
    problems.push(`created, ${q.created}, isn't a real date`);
  }
  if (typeof q.title !== 'string' || !q.title.trim()) problems.push('title must be text');
  if (!DIFFICULTIES.includes(q.difficulty)) problems.push(`difficulty must be one of ${DIFFICULTIES.join(', ')}`);
  for (const field of ['topics', 'sources']) {
    if (!Array.isArray(q[field]) || !q[field].every((x) => typeof x === 'string' && x.trim())) problems.push(`${field} must be a list of names (it may be empty)`);
  }
  const mode = q.judgeMode === undefined ? 'function' : q.judgeMode;
  if (mode !== 'function' && mode !== 'program') problems.push('judgeMode must be "function" or "program" (or left out, meaning "function")');

  // The languages: starterCode's keys. Everything per language follows them.
  if (!isPlainObject(q.starterCode) || !Object.keys(q.starterCode).length) {
    problems.push('starterCode must give the starting code for at least one language');
    return problems; // the per-language checks need the languages
  }
  const languages = Object.keys(q.starterCode);
  const known = ['javascript', 'python', 'cpp', 'java', 'd'];
  for (const language of languages) {
    if (!known.includes(language)) problems.push(`starterCode.${language}: not a language the judge knows (${known.join(', ')})`);
    else if (typeof q.starterCode[language] !== 'string') problems.push(`starterCode.${language} must be text`);
  }

  /**
   * Checks a per-language field: an object with exactly starterCode's
   * languages, each value passing `ok`.
   *
   * @param {string} field - The field's name, e.g. "description".
   * @param {(value: any) => boolean} ok - Whether one language's value is right.
   * @param {string} what - What each value must be, for the message.
   * @param {boolean} [optional] - True if the whole field may be left out.
   * @returns {void}
   */
  const perLanguage = (field, ok, what, optional = false) => {
    if (q[field] === undefined && optional) return;
    if (!isPlainObject(q[field])) {
      problems.push(`${field} must be an object keyed by language (${languages.join(', ')})`);
      return;
    }
    for (const language of languages) {
      if (q[field][language] === undefined) {
        if (!optional) problems.push(`${field}.${language} is missing: starterCode has ${language}`);
      } else if (!ok(q[field][language])) {
        problems.push(`${field}.${language} must be ${what}`);
      }
    }
    for (const language of Object.keys(q[field])) {
      if (!languages.includes(language)) problems.push(`${field}.${language}: starterCode has no ${language}`);
    }
  };
  /**
   * Whether value is non-empty text.
   *
   * @param {unknown} value - The value.
   * @returns {boolean} True if so.
   */
  const text = (value) => typeof value === 'string' && value.trim() !== '';
  perLanguage('description', text, 'HTML text');
  perLanguage('examples', (v) => Array.isArray(v) && v.every((ex) => isPlainObject(ex) && typeof ex.input === 'string' && typeof ex.output === 'string' && (ex.explanation === undefined || typeof ex.explanation === 'string')), 'a list of { input, output, explanation? }, each text');
  perLanguage('constraints', (v) => Array.isArray(v) && v.every((c) => typeof c === 'string'), 'a list of text (it may be empty)');
  perLanguage('learning', text, 'HTML text', true);

  if (mode === 'function') {
    perLanguage('functionName', text, 'the function\'s name, which the judge calls');
    for (const language of languages.filter((l) => TYPED_LANGUAGES.includes(l))) {
      const sig = isPlainObject(q.signature) ? q.signature[language] : undefined;
      if (!isPlainObject(sig) || !Array.isArray(sig.params) || !sig.params.every((t) => typeof t === 'string') || typeof sig.returns !== 'string') {
        problems.push(`signature.${language} must be { params: [types], returns: type }: the judge needs the types to build a ${language} harness`);
      }
    }
  } else {
    if (q.functionName !== undefined) problems.push('functionName is only for judgeMode "function"');
    if (q.signature !== undefined) problems.push('signature is only for judgeMode "function"');
  }

  if (!Array.isArray(q.testCases) || !q.testCases.length) {
    problems.push('testCases must be a list of at least one test case');
    return problems;
  }
  q.testCases.forEach(
    /**
     * Checks one test case.
     *
     * @param {unknown} tc - The test case.
     * @param {number} i - Its position.
     * @returns {void}
     */
    (tc, i) => {
      const where = `testCases[${i}]`;
      if (!isPlainObject(tc)) {
        problems.push(`${where} must be an object`);
        return;
      }
      const fields = mode === 'function' ? ['args', 'expected', 'hidden'] : ['input', 'expected', 'hidden'];
      const extra = Object.keys(tc).filter((k) => !fields.includes(k));
      if (extra.length) problems.push(`${where}: unknown ${extra.map((k) => JSON.stringify(k)).join(', ')} (in judgeMode "${mode}" a test case has ${fields.join(', ')})`);
      if (mode === 'function' && !Array.isArray(tc.args)) problems.push(`${where}.args must be the list of arguments (an empty list for none)`);
      if (mode === 'program' && typeof tc.input !== 'string') problems.push(`${where}.input must be the program's standard input, as text`);
      if (!('expected' in tc)) problems.push(`${where}.expected is missing (null is allowed: it means the function returns null or None)`);
      else if (mode === 'program' && typeof tc.expected !== 'string') problems.push(`${where}.expected must be the expected standard output, as text`);
      if (tc.hidden !== undefined && typeof tc.hidden !== 'boolean') problems.push(`${where}.hidden must be true or false`);
    },
  );
  if (!q.testCases.some((tc) => isPlainObject(tc) && !tc.hidden)) problems.push('testCases: at least one must be visible (not hidden), or Run has nothing to run');
  return problems;
}

module.exports = { QUESTIONS_DIR, RENAMES_FILE, isQuestionFile, questionInfos, readRenamesText, checkQuestion, QUESTION_FIELDS };

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
 * @property {string} [kind] - "code" or "fill-in" (#160); absent means
 *   "code". Read it through kindOf(), never directly.
 * @property {string} title
 * @property {string} difficulty - "Fundamentals", "Easy", "Medium" or "Hard"
 *   (DIFFICULTIES).
 * @property {string[]} topics
 * @property {string[]} sources
 * @property {string[]} [alreadyLearned] - The slugs of the questions it
 *   builds on directly; missing if none (an empty list is refused).
 * @property {string} created - UTC ISO 8601 (step 3).
 * @property {Record<string, string>} [starterCode] - By language; a
 *   "code" question's languages are its keys.
 * @property {Record<string, string>} [template] - By language: the code
 *   shown, with the blank; a "fill-in" question's languages are its keys.
 * @property {string} [blank] - A "fill-in" question's marker for the
 *   blank, which appears exactly once in each template, e.g. "___".
 * @property {number} [maxLength] - The most characters a "fill-in"
 *   question's blank takes; read through fillInMaxLength().
 */

/**
 * What order.js needs to know about a question, and what GET /api/next and
 * GET /api/queue show of it. alreadyLearned is for order.js (#146), which
 * puts a question after the ones it builds on.
 *
 * @typedef {import('./order').QuestionInfo & Pick<QuestionFile, 'title' | 'difficulty' | 'topics' | 'sources' | 'alreadyLearned'>} QuestionListing
 */

/**
 * What order.js needs to know about every question in questions/ (moved
 * here from server.js in step 10, unchanged).
 *
 * @returns {QuestionListing[]} One per question file: its file name without
 *   .json (D1), created, its languages (languagesOf), title, difficulty,
 *   topics, sources and alreadyLearned (undefined where it builds on none).
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
       *   difficulty, topics, sources and alreadyLearned.
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
        const { title, difficulty, topics, sources, alreadyLearned } = problem;
        return { slug: f.slice(0, -'.json'.length), created: problem.created, languages: languagesOf(problem), title, difficulty, topics, sources, alreadyLearned };
      },
    );
}

/** The kinds of question (#160, Q3): what the rest of a question file holds. @type {readonly string[]} */
const QUESTION_KINDS = Object.freeze(['code', 'fill-in']);
/** A fill-in question's maxLength when its file gives none (#160, Q8). @type {number} */
const DEFAULT_MAX_LENGTH = 10;
/** The most any fill-in question's maxLength may be (#160, Q15). @type {number} */
const MAX_LENGTH_CAP = 100;

/**
 * A question's kind: its `kind` field, or "code" when it has none (#160,
 * Q3, rule 1). Every reader asks this function rather than reading the
 * field, so an absent kind means the same thing everywhere, and the 15
 * questions written before kinds existed need no edit (which would change
 * every saved record's questionSha256). It doesn't check the kind:
 * checkQuestion refuses an unknown one.
 *
 * @param {{ kind?: string }} question - A question file's contents.
 * @returns {string} Its kind, e.g. "code" or "fill-in".
 */
function kindOf(question) {
  return question.kind === undefined ? 'code' : question.kind;
}

/**
 * The languages a question can be answered in (#160, Q3, rule 4): a
 * "code" question's starterCode keys, a "fill-in" question's template
 * keys. Learners' (question, language) pairs are made from these.
 *
 * @param {Pick<QuestionFile, 'kind' | 'starterCode' | 'template'>} question -
 *   A question file's contents (only these fields are read), as
 *   checkQuestion accepts it.
 * @returns {string[]} The languages; empty for an unknown kind.
 */
function languagesOf(question) {
  const kind = kindOf(question);
  const byLanguage = kind === 'code' ? question.starterCode : kind === 'fill-in' ? question.template : undefined;
  return byLanguage ? Object.keys(byLanguage) : [];
}

/**
 * A fill-in question's limit on its blank, in UTF-16 code units, which is
 * what JavaScript's `.length` and HTML's `maxlength` both count (#160, Q8):
 * its `maxLength`, or DEFAULT_MAX_LENGTH when it gives none.
 *
 * @param {{ maxLength?: number }} question - A fill-in question file's
 *   contents, as checkQuestion accepts it.
 * @returns {number} The most characters the blank takes.
 */
function fillInMaxLength(question) {
  return question.maxLength === undefined ? DEFAULT_MAX_LENGTH : question.maxLength;
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

/** The fields every kind of question has (readme.html, "Problem file format"). @type {readonly string[]} */
const COMMON_FIELDS = Object.freeze(['slug', 'created', 'title', 'difficulty', 'topics', 'sources', 'alreadyLearned', 'kind', 'learning', 'description']);
/**
 * Each kind's own fields (#160, Q3): a question may have the common ones
 * and its kind's, and checkQuestion refuses another kind's.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
const KIND_FIELDS = Object.freeze({
  code: Object.freeze(['judgeMode', 'examples', 'constraints', 'starterCode', 'functionName', 'signature', 'testCases']),
  'fill-in': Object.freeze(['template', 'blank', 'maxLength']),
});
/** Every field any kind of question may have. @type {readonly string[]} */
const QUESTION_FIELDS = Object.freeze([...COMMON_FIELDS, ...QUESTION_KINDS.flatMap((kind) => KIND_FIELDS[kind])]);
/**
 * The difficulties the list shows, easiest first. Fundamentals (owner,
 * 2026-11-08, #93) is for questions whose new concept is a feature of the
 * language or its library (docs/roles/questions/how-to-write-a-question.md).
 * @type {readonly string[]}
 */
const DIFFICULTIES = Object.freeze(['Fundamentals', 'Easy', 'Medium', 'Hard']);
/** The languages whose judge harness needs a signature (judge/runner.js). @type {readonly string[]} */
const TYPED_LANGUAGES = Object.freeze(['cpp', 'java', 'd']);
// UTC ISO 8601 to the second, e.g. 2026-10-24T05:31:05Z. UTC only, so that
// comparing two as text gives the same order as comparing them as times
// (RFC 3339, section 5.1).
const CREATED_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
// A link from a Learning tab to another question, as "Learned earlier"
// writes it: <a href="/problem.html?slug=double-each-character" ...>. The
// slug is everything up to the closing quote, so a misspelt one is caught.
const QUESTION_LINK_PATTERN = /\/problem\.html\?slug=([^"'&#\s<>]+)/g;

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
 * @param {readonly string[]} [slugs] - Every question's slug, the file
 *   names in questions/ without .json. If given, each of alreadyLearned's
 *   entries must be one of them; if left out, that isn't checked.
 * @returns {string[]} The problems, each naming the field; empty if none.
 */
function checkQuestion(question, fileName, slugs) {
  if (!isPlainObject(question)) return ['must be a JSON object'];
  /** @type {string[]} */
  const problems = [];
  const q = question;
  // The kind first (#160, Q3): it decides which other fields are allowed.
  const kind = kindOf(q);
  const kindKnown = typeof kind === 'string' && QUESTION_KINDS.includes(kind);
  if (!kindKnown) problems.push(`kind must be ${QUESTION_KINDS.map((k) => JSON.stringify(k)).join(' or ')} (or left out, meaning "code")`);
  const allowed = kindKnown ? [...COMMON_FIELDS, ...KIND_FIELDS[kind]] : QUESTION_FIELDS;
  for (const key of Object.keys(q).filter((k) => !allowed.includes(k) && QUESTION_FIELDS.includes(k))) {
    const owner = QUESTION_KINDS.find((k) => KIND_FIELDS[k].includes(key));
    problems.push(`${key} is only for kind ${JSON.stringify(owner)}, not ${JSON.stringify(kind)}`);
  }
  const unknown = Object.keys(q).filter((key) => !QUESTION_FIELDS.includes(key));
  if (unknown.length) problems.push(`unknown ${unknown.length === 1 ? 'field' : 'fields'} ${unknown.map((k) => JSON.stringify(k)).join(', ')} (a typo? the fields are ${allowed.join(', ')})`);

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
  // alreadyLearned: the questions this one builds on (owner, 2026-11-05;
  // docs/roles/questions/how-to-write-a-question.md), left out if none.
  /** @type {string[]} */
  let learned = [];
  if (q.alreadyLearned !== undefined) {
    if (!Array.isArray(q.alreadyLearned) || !q.alreadyLearned.length || !q.alreadyLearned.every((s) => typeof s === 'string' && s.trim())) {
      problems.push('alreadyLearned must be a list of question slugs, e.g. ["double-each-character"] (leave it out if the question builds on none)');
    } else {
      learned = q.alreadyLearned;
      const own = fileName.replace(/\.json$/, '');
      const seen = new Set();
      for (const slug of learned) {
        if (seen.has(slug)) problems.push(`alreadyLearned lists ${JSON.stringify(slug)} twice`);
        seen.add(slug);
        if (slug === own) problems.push(`alreadyLearned can't list the question itself, ${JSON.stringify(own)}`);
        else if (slugs && !slugs.includes(slug)) problems.push(`alreadyLearned: there's no question ${JSON.stringify(slug)} in questions/`);
      }
    }
  }
  if (!kindKnown) return problems; // what else to check depends on the kind
  const mode = q.judgeMode === undefined ? 'function' : q.judgeMode;
  if (kind === 'code' && mode !== 'function' && mode !== 'program') problems.push('judgeMode must be "function" or "program" (or left out, meaning "function")');

  // The languages: starterCode's keys, or a fill-in question's template's
  // (languagesOf). Everything per language follows them.
  const source = kind === 'fill-in' ? 'template' : 'starterCode';
  if (!isPlainObject(q[source]) || !Object.keys(q[source]).length) {
    problems.push(kind === 'fill-in' ? 'template must give the code, with the blank, for at least one language' : 'starterCode must give the starting code for at least one language');
    return problems; // the per-language checks need the languages
  }
  const languages = Object.keys(q[source]);
  const known = ['javascript', 'python', 'cpp', 'java', 'd'];
  for (const language of languages) {
    if (!known.includes(language)) problems.push(`${source}.${language}: not a language the judge knows (${known.join(', ')})`);
    else if (typeof q[source][language] !== 'string') problems.push(`${source}.${language} must be text`);
  }

  /**
   * Checks a per-language field: an object with exactly the question's
   * languages (its starterCode's or template's keys), each value passing
   * `ok`.
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
        if (!optional) problems.push(`${field}.${language} is missing: ${source} has ${language}`);
      } else if (!ok(q[field][language])) {
        problems.push(`${field}.${language} must be ${what}`);
      }
    }
    for (const language of Object.keys(q[field])) {
      if (!languages.includes(language)) problems.push(`${field}.${language}: ${source} has no ${language}`);
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
  if (kind === 'code') {
    perLanguage('examples', (v) => Array.isArray(v) && v.every((ex) => isPlainObject(ex) && typeof ex.input === 'string' && typeof ex.output === 'string' && (ex.explanation === undefined || typeof ex.explanation === 'string')), 'a list of { input, output, explanation? }, each text');
    perLanguage('constraints', (v) => Array.isArray(v) && v.every((c) => typeof c === 'string'), 'a list of text (it may be empty)');
  }
  perLanguage('learning', text, 'HTML text', true);
  // Each Learning tab's "Learned earlier" links are alreadyLearned, no more
  // and no fewer, so the page and the field can't drift apart.
  if (isPlainObject(q.learning)) {
    for (const language of languages) {
      const html = q.learning[language];
      if (typeof html !== 'string') continue;
      const linked = new Set(Array.from(html.matchAll(QUESTION_LINK_PATTERN), (m) => m[1]));
      for (const slug of linked) {
        if (!learned.includes(slug)) problems.push(`learning.${language} links to ${JSON.stringify(slug)} (/problem.html?slug=${slug}), but alreadyLearned doesn't list it`);
      }
      for (const slug of learned) {
        if (!linked.has(slug)) problems.push(`learning.${language}: no "Learned earlier" link to ${JSON.stringify(slug)}, which alreadyLearned lists`);
      }
    }
  }

  if (kind === 'fill-in') return [...problems, ...checkFillIn(q, languages)];

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

/**
 * What's wrong with a fill-in question's own fields (#160, Q3 and Q8):
 * `blank`, the marker, one line of text; each language's template holding
 * it exactly once, so the page knows where the input box goes; and
 * `maxLength`, if given, a whole number from 1 to MAX_LENGTH_CAP (#160,
 * Q15), so no one file can lift the limit users' routes check.
 * checkQuestion has already checked that each template is text.
 *
 * @param {Record<string, any>} q - The question file's contents, a plain
 *   object whose kind is "fill-in".
 * @param {readonly string[]} languages - Its template's keys.
 * @returns {string[]} The problems, each naming the field; empty if none.
 */
function checkFillIn(q, languages) {
  /** @type {string[]} */
  const problems = [];
  const marker = q.blank;
  if (typeof marker !== 'string' || !marker.trim() || /[\r\n]/.test(marker)) {
    problems.push('blank must be the text that marks the blank in each template, on one line, e.g. "___"');
  } else {
    for (const language of languages) {
      const template = q.template[language];
      if (typeof template !== 'string') continue; // reported already
      const count = template.split(marker).length - 1;
      if (count !== 1) problems.push(`template.${language} must contain the blank, ${JSON.stringify(marker)}, exactly once (it has it ${count} times)`);
    }
  }
  if (q.maxLength !== undefined && !(Number.isInteger(q.maxLength) && q.maxLength >= 1 && q.maxLength <= MAX_LENGTH_CAP)) {
    problems.push(`maxLength must be a whole number from 1 to ${MAX_LENGTH_CAP} (or left out, meaning ${DEFAULT_MAX_LENGTH})`);
  }
  return problems;
}

/**
 * A loop in what questions build on (alreadyLearned): a question that,
 * through the ones it builds on, builds on itself. Then no order could show
 * every question after the ones it builds on. Needs every question at once,
 * so it isn't part of checkQuestion.
 *
 * @param {Record<string, readonly string[]>} learnedBySlug - Each question's
 *   slug and its alreadyLearned ([] for none). An entry naming a question
 *   not in it is ignored: checkQuestion reports that.
 * @returns {string[] | null} A loop, as the slugs in order with the first
 *   repeated at the end (["a", "b", "a"]), or null if there's none.
 */
function findLearnedLoop(learnedBySlug) {
  /** Where each question is: absent (not visited), 'open' (on the current path) or 'done'. @type {Map<string, 'open' | 'done'>} */
  const state = new Map();
  /** @type {string[]} */
  const pathSoFar = [];
  /**
   * Depth-first search from one question.
   *
   * @param {string} slug - The question.
   * @returns {string[] | null} A loop through it or after it, or null.
   */
  const visit = (slug) => {
    state.set(slug, 'open');
    pathSoFar.push(slug);
    for (const next of learnedBySlug[slug] || []) {
      if (!(next in learnedBySlug)) continue;
      if (state.get(next) === 'open') return [...pathSoFar.slice(pathSoFar.indexOf(next)), next];
      if (!state.has(next)) {
        const loop = visit(next);
        if (loop) return loop;
      }
    }
    pathSoFar.pop();
    state.set(slug, 'done');
    return null;
  };
  for (const slug of Object.keys(learnedBySlug).sort()) {
    if (!state.has(slug)) {
      const loop = visit(slug);
      if (loop) return loop;
    }
  }
  return null;
}

/**
 * Entries of alreadyLearned that a question already reaches through
 * another of its entries: alreadyLearned lists only the questions it builds
 * on directly, and the ones they build on come with them (owner,
 * 2026-11-06). Run it after findLearnedLoop finds no loop.
 *
 * @param {Record<string, readonly string[]>} learnedBySlug - Each question's
 *   slug and its alreadyLearned ([] for none). Entries naming a question
 *   not in it are ignored.
 * @returns {string[]} A message for each redundant entry, naming the
 *   question, the entry and the entry it comes through; empty if none.
 */
function findRedundantLearned(learnedBySlug) {
  /** Every question reachable from a slug, itself excluded, once worked out. @type {Map<string, Set<string>>} */
  const reachable = new Map();
  /**
   * The questions a question builds on, directly or not.
   *
   * @param {string} slug - The question.
   * @returns {Set<string>} Them.
   */
  const reach = (slug) => {
    const known = reachable.get(slug);
    if (known) return known;
    /** @type {Set<string>} */
    const found = new Set();
    reachable.set(slug, found); // no loops (findLearnedLoop), so this can't be read half-built
    for (const next of learnedBySlug[slug] || []) {
      if (!(next in learnedBySlug)) continue;
      found.add(next);
      for (const further of reach(next)) found.add(further);
    }
    return found;
  };
  /** @type {string[]} */
  const problems = [];
  for (const slug of Object.keys(learnedBySlug).sort()) {
    const entries = (learnedBySlug[slug] || []).filter((e) => e in learnedBySlug);
    for (const entry of entries) {
      const via = entries.find((other) => other !== entry && reach(other).has(entry));
      if (via) problems.push(`${slug}: alreadyLearned lists ${entry}, which it already builds on through ${via}: list only the questions it builds on directly`);
    }
  }
  return problems;
}

module.exports = { QUESTIONS_DIR, RENAMES_FILE, isQuestionFile, questionInfos, readRenamesText, checkQuestion, findLearnedLoop, findRedundantLearned, QUESTION_FIELDS, QUESTION_KINDS, kindOf, languagesOf, fillInMaxLength, MAX_LENGTH_CAP };

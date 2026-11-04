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

module.exports = { QUESTIONS_DIR, RENAMES_FILE, isQuestionFile, questionInfos, readRenamesText };

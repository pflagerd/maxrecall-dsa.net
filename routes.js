// The feature routes: questions, Run, Submit, Test and Skip, saved
// submissions, the learner's profile, Next and the queue
// (docs/plans/server-split.md). An Express Router, which server.js mounts
// after its sign-in gate: every request that reaches these routes is signed
// in, with req.userEmail set from a live session or the trusted listener,
// and this file adds no public path or served file of its own (contract 9,
// docs/contracts.md). The sign-in layer, what's served and listening are
// server.js's.

const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const path = require('path');

const { runSubmission } = require('./judge/runner');
const { judgeFillInTheBlank, judgeSha256Of } = require('./judge/fill-in-the-blank');
const { canTestQuestions, revealHidden, markRevealed } = require('./playtest');
const { resolveInside } = require('./paths');
const { OWNER_EMAIL, saveSubmission, listSubmissions, loadSubmission, readProfileFile, writeProfileFile, readUserFile, writeUserFile, listUsers, testBankRefusal } = require('./users');
const { LANGUAGES, parseProfile, applyPreferredChange } = require('./profile');
const { QUESTIONS_DIR, isQuestionFile, questionInfos, kindOf, fillInTheBlankMaxLength } = require('./question-files');
const { checkConsistency, countLevels, formatFinding, describeCounts } = require('./consistency');
const { readSources } = require('./scripts/consistency-check');
const { parseQueueFiles, backlogPairs, fillBacklog, passFor, recordSubmit, nextPair, listPairs, canOpenPair } = require('./order');

// AppRequest is server.js's (who a request is from). A type import, which
// TypeScript checks and Node never runs: routes.js doesn't require
// server.js, which requires it.
/** @typedef {import('./server').AppRequest} AppRequest */
/** @typedef {import('express').Response} Response */
/** @typedef {import('./users').SavedSubmission} SavedSubmission */

/**
 * One test case in a question file. Function mode has args, program mode
 * has input (readme.html, "Problem file format").
 *
 * @typedef {object} TestCase
 * @property {unknown[]} [args] - Function mode: the arguments to call with.
 * @property {string} [input] - Program mode: the program's standard input.
 * @property {unknown} expected - The expected return value (function mode)
 *   or standard output (program mode).
 * @property {boolean} [hidden] - True if it's only used by Submit, and never
 *   sent to the browser.
 */

/**
 * A question file, questions/<slug>.json, as far as the server uses it.
 * Fields shown only by the page (description, learning, examples,
 * constraints) aren't listed; they're passed through unchanged.
 *
 * @typedef {object} Problem
 * @property {string} slug - Its id; should match the file name.
 * @property {string} title
 * @property {string} difficulty - "Fundamentals", "Easy", "Medium" or "Hard".
 * @property {string[]} topics
 * @property {string[]} sources
 * @property {string} created - When it was created, as UTC ISO 8601
 *   (spaced-repetition plan, step 3): the backlog's order.
 * @property {string} [judgeMode] - "function" (the default) or "program".
 * @property {Record<string, string>} starterCode - By language; a language
 *   missing here can't be submitted for this question.
 * @property {Record<string, string>} [functionName] - Function mode: the
 *   function to call, by language.
 * @property {Record<string, import('./judge/runner').FunctionSignature>} [signature] -
 *   Function mode, cpp/java/d only: the types the harness needs.
 * @property {TestCase[]} testCases
 * @property {string} [kind] - "code" or "fill-in-the-blank" (#160); read
 *   through question-files.js's kindOf(), never directly. A
 *   "fill-in-the-blank" question has no starterCode or testCases, but
 *   template, blank, maxLength and initialWidth; only the public view and Run
 *   (toPublicProblem, handleExecution) take one so far.
 * @property {Record<string, string>} [template] - Fill-in-the-blank: the
 *   code shown, with the blank, by language.
 * @property {string} [blank] - Fill-in-the-blank: the blank's marker in
 *   each template, e.g. "___".
 * @property {number} [maxLength] - Fill-in-the-blank: read through
 *   fillInTheBlankMaxLength().
 * @property {number} [initialWidth] - Fill-in-the-blank: how many
 *   characters wide the page's box starts, and the narrowest it gets
 *   (owner, 2026-11-10). The format requires it; the server only passes
 *   it on.
 */

/**
 * One line of the problem list (GET /api/questions).
 *
 * @typedef {Pick<Problem, 'slug' | 'title' | 'difficulty' | 'topics' | 'sources'>} ProblemSummary
 */

/**
 * One line of the Submissions tab (GET /api/submissions): a saved Submit
 * without its code, stdout and stderr.
 *
 * @typedef {object} SubmissionSummary
 * @property {string} id
 * @property {string} submittedAt
 * @property {string} question
 * @property {string} language
 * @property {string} kind - "code" or "fill-in-the-blank"; "code" for a
 *   record from before version 4, which has none.
 * @property {string | null} status - null for a Skip.
 * @property {number | null} passed - null for a Skip and a fill-in-the-blank
 *   answer.
 * @property {number | null} total - null as passed is.
 * @property {number | null} runtimeMs - null as passed is.
 * @property {number | null} elapsedMs - null if the record doesn't have it.
 * @property {'yes'} [skipped] - "yes" for a Skip (step 8; D8); absent for a
 *   Submit.
 * @property {{ blank: string }} [answer] - A fill-in-the-blank record's answer
 *   (owner, 2026-11-09: the Submissions tab shows what was typed).
 * @property {string} [message] - A fill-in-the-blank judge's message, when
 *   it gave one (records v4, D3).
 */

/**
 * What the judge can throw (judge/sandbox.js, judge/queue.js): an Error
 * whose code says when the server should answer 503 rather than 500.
 *
 * @typedef {Error & { code?: string, retryAfterSeconds?: number }} JudgeError
 */

const router = express.Router();

// The judge's five languages, kept in one place (profile.js).
const SUPPORTED_LANGUAGES = LANGUAGES;

// --- Problem data -----------------------------------------------------

/**
 * Reads a question file. Returns the parsed problem, and the SHA-256 of the
 * file's exact bytes so a saved submission can tell later whether the
 * question has been edited since. Both come from one read, so they match.
 *
 * @param {string} slug - The question's id, from the request; kept inside
 *   questions/ by resolveInside().
 * @returns {{ problem: Problem, sha256: string } | null} The problem and the
 *   file's SHA-256 (hex), or null if there's no such question.
 * @throws {SyntaxError} If the file isn't valid JSON.
 */
function loadProblem(slug) {
  if (!isQuestionFile(`${slug}.json`)) return null; // e.g. "renames", the rename log
  const file = resolveInside(QUESTIONS_DIR, `${slug}.json`);
  if (!file || !fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  return {
    problem: JSON.parse(bytes.toString('utf8')),
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

/**
 * Every question in questions/, for the problem list.
 *
 * @returns {ProblemSummary[]} One per .json file, sorted by title.
 * @throws {Error} If questions/ can't be read, or a file isn't valid JSON.
 */
function listProblems() {
  return fs
    .readdirSync(QUESTIONS_DIR)
    .filter(isQuestionFile)
    .map(
    /**
     * Reads one question file's summary.
     *
     * @param {string} f - The file's name in questions/.
     * @returns {ProblemSummary} Its slug, title, difficulty, topics and sources.
     */
    (f) => {
        const { slug, title, difficulty, topics, sources } = JSON.parse(
          fs.readFileSync(path.join(QUESTIONS_DIR, f), 'utf8')
        );
        return { slug, title, difficulty, topics, sources };
      },
  )
    .sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * The fields of a question file that every kind's public view sends (#160,
 * Q4; contract 4), an allow-list: a field not named in a kind's list stays
 * on the server, so a new field in the problem format is private until it's
 * added on purpose. Not sent, since the page doesn't use it (owner,
 * 2026-11-08): created (the question bank has its own route,
 * GET /api/question-bank). A question of a kind this server doesn't know
 * gets only these, so the page can name it and say it can't show it.
 */
const PUBLIC_COMMON_FIELDS = Object.freeze(['slug', 'title', 'difficulty', 'topics', 'sources', 'alreadyLearned', 'learning', 'description']);

/**
 * The public view of a "code" question: the common fields and its own.
 * testCases is never named (contract 4: the hidden test cases are never
 * sent); toPublicProblem() sends visibleTestCases and hiddenCount in its
 * place. Not sent either, since the page doesn't use them (owner,
 * 2026-11-08): the judge's judgeMode, functionName and signature.
 */
const PUBLIC_CODE_FIELDS = Object.freeze([...PUBLIC_COMMON_FIELDS, 'examples', 'constraints', 'starterCode']);

/**
 * The public view of a "fill-in-the-blank" question (#160): the common
 * fields, its template (the code shown, by language), blank (the marker
 * the page puts the input box in place of) and initialWidth (how wide that
 * box starts: contract 4 says it may be sent; it tells a learner nothing
 * the box doesn't show). Nothing of its judge, which is
 * a file of its own, questions/<slug>.judge.js (contract 4: never sent).
 * toPublicProblem() adds maxLength, with its default filled in.
 */
const PUBLIC_FILL_IN_THE_BLANK_FIELDS = Object.freeze([...PUBLIC_COMMON_FIELDS, 'template', 'blank', 'initialWidth']);

/**
 * The fields of a question that a list allows, in the order its file has
 * them (Object.entries keeps it, so the JSON sent follows the file).
 *
 * @param {Problem} problem - The question as read from its file.
 * @param {readonly string[]} fields - The allow-list.
 * @returns {Partial<Problem>} Only those of its fields that are named.
 */
function allowedFields(problem, fields) {
  return Object.fromEntries(Object.entries(problem).filter(([field]) => fields.includes(field)));
}

/**
 * What GET /api/questions/:slug sends for a question: its kind's public
 * view, and `kind` itself (from kindOf(), so a file without one says
 * "code"), for the page to choose how to show it.
 * - "code": PUBLIC_CODE_FIELDS, then the visible test cases and how many
 *   are hidden. Test case shape depends on judgeMode (args/expected for
 *   "function", input/expected for "program"), so a visible one is sent
 *   whole, without just its `hidden` field.
 * - "fill-in-the-blank": PUBLIC_FILL_IN_THE_BLANK_FIELDS, and maxLength
 *   from fillInTheBlankMaxLength(), so the page needn't know its default.
 * - Any other kind: PUBLIC_COMMON_FIELDS only.
 *
 * @param {Problem} problem - The question as read from its file.
 * @returns {Partial<Omit<Problem, 'testCases'>> & { kind: string, visibleTestCases?: Omit<TestCase, 'hidden'>[], hiddenCount?: number, maxLength?: number }}
 *   The allowed fields and `kind`; for "code", the visible test cases
 *   without their `hidden` field and how many are hidden; for
 *   "fill-in-the-blank", maxLength.
 */
function toPublicProblem(problem) {
  const kind = kindOf(problem);
  if (kind === 'code') {
    const { testCases } = problem;
    return {
      ...allowedFields(problem, PUBLIC_CODE_FIELDS),
      kind,
      visibleTestCases: testCases
        .filter((tc) => !tc.hidden)
        .map(({ hidden, ...tc }) => tc),
      hiddenCount: testCases.filter((tc) => tc.hidden).length,
    };
  }
  if (kind === 'fill-in-the-blank') {
    return { ...allowedFields(problem, PUBLIC_FILL_IN_THE_BLANK_FIELDS), kind, maxLength: fillInTheBlankMaxLength(problem) };
  }
  return { ...allowedFields(problem, PUBLIC_COMMON_FIELDS), kind };
}

// --- API ----------------------------------------------------------------

router.get(
  '/api/questions',
  /**
   * GET /api/questions: the problem list.
   *
   * @param {import('express').Request} req - The request.
   * @param {Response} res - ProblemSummary[], sorted by title.
   * @returns {void}
   */
  (req, res) => {
    res.json(listProblems());
  },
);

router.get(
  '/api/questions/:slug',
  /**
   * GET /api/questions/:slug: one question, without its hidden test cases.
   *
   * @param {import('express').Request} req - req.params.slug names the question.
   * @param {Response} res - toPublicProblem()'s result, or 404.
   * @returns {Response | void} Nothing that's used.
   */
  (req, res) => {
    const loaded = loadProblem(req.params.slug);
    if (!loaded) return res.status(404).json({ error: 'Question not found' });
    res.json(toPublicProblem(loaded.problem));
  },
);

/**
 * A Run, Submit or Skip request that passed checkExecutionRequest().
 *
 * @typedef {object} CheckedRequest
 * @property {Problem} problem - The question.
 * @property {string} sha256 - Its file's SHA-256, for the record.
 * @property {string} email - The signed-in user.
 * @property {string} language - One of SUPPORTED_LANGUAGES, allowed by the
 *   profile and the question.
 * @property {string} kind - The question's kind, from kindOf(): "code" or
 *   "fill-in-the-blank" (checkExecutionRequest refuses any other).
 * @property {string} [code] - A code question's: the editor's code.
 * @property {{ blank: string }} [answer] - A fill-in-the-blank question's:
 *   the learner's answer, checked by checkFillInTheBlankAnswer().
 * @property {number | undefined} elapsedMs - The page's timer, if sent.
 */

/**
 * Why a fill-in-the-blank answer can't be judged, or null if it can
 * (contract 2; #160's Q12): it must be an object with one field, blank, a
 * string (typeof: express.json() would also pass an array, or
 * { length: 1 }) no longer than the question's maxLength, counted in
 * UTF-16 code units (.length), as HTML's maxlength counts. Checked before
 * questions' judge is called, so nothing is judged or recorded for
 * anything else.
 *
 * @param {unknown} answer - The request's answer, as express.json() parsed
 *   it: any JSON value, or undefined if it wasn't sent.
 * @param {Problem} problem - The fill-in-the-blank question.
 * @returns {string | null} The reason, for a 400, or null if it's valid.
 */
function checkFillInTheBlankAnswer(answer, problem) {
  if (typeof answer !== 'object' || answer === null || Array.isArray(answer)) return 'answer must be an object, { blank }';
  const fields = Object.keys(answer);
  if (fields.length !== 1 || fields[0] !== 'blank') return 'answer must have one field, blank, and no other';
  const { blank } = /** @type {{ blank: unknown }} */ (answer);
  if (typeof blank !== 'string') return 'blank must be a string';
  const most = fillInTheBlankMaxLength(problem);
  if (blank.length > most) return `blank must be at most ${most} characters`;
  return null;
}

/**
 * The checks Run, Submit, Skip and Test share, so they refuse the same
 * things: 404 for an unknown question; 400 for a bad language, code or
 * elapsedMs, or a language the question lacks; 403 for one the profile
 * doesn't allow; 500 for an invalid profile or queue file (fail closed).
 * Each refusal is sent here. For Test (issue #58, detail 5) the profile
 * and queue files aren't consulted: it tests the question in any language
 * it has, and changes nothing of the learner's.
 *
 * A feature, not a gap (owner, 2026-11-06): nothing here checks that the
 * question is in the learner's queue or chosen backlog. Any question can
 * be opened by its slug, and its Submit or Skip puts it straight into the
 * queue (order.js, recordSubmit, rule 1): that's how a learner queues a
 * question they choose (docs/how-to-put-a-question-directly-into-my-queue-by-slug.html).
 * Don't add such a check: routes.test.js fails if one is added (its test
 * "a feature: a question not in a chosen backlog, ..."). A chosen backlog
 * limits what the list and Next offer; the profile's languages are what's
 * enforced (403 above).
 *
 * By kind (#160 step 4; owner, 2026-11-09): a "fill-in-the-blank"
 * question takes { language, answer: { blank }, elapsedMs? } in place of
 * code, checked by checkFillInTheBlankAnswer() (400), for Run, Submit and
 * Skip alike (a blank may be empty, as a Skip's code may); Test is for
 * code questions (400). A kind this server doesn't know gets 501 from all
 * four.
 *
 * @param {AppRequest} req - The request; its body should be
 *   { language, code, elapsedMs? }, or for a fill-in-the-blank question
 *   { language, answer, elapsedMs? }.
 * @param {Response} res - The response, sent if the request is refused.
 * @param {{ codeRequired: boolean, action: 'run' | 'submit' | 'skip' | 'test' }} options -
 *   codeRequired: false for Skip, whose code may be empty (step 8, detail
 *   5); it must still be a string. action: which button it is; Test skips
 *   the profile and queue checks.
 * @returns {CheckedRequest | null} What was asked, or null if refused.
 */
function checkExecutionRequest(req, res, { codeRequired, action }) {
  const forTest = action === 'test';
  const loaded = loadProblem(req.params.slug);
  if (!loaded) {
    res.status(404).json({ error: 'Question not found' });
    return null;
  }
  const { problem } = loaded;
  const kind = kindOf(problem);
  /** @type {string} */
  const email = /** @type {string} */ (req.userEmail); // signed in: the gate

  const { language, code, answer, elapsedMs } = req.body || {};
  /**
   * Sends one refusal.
   *
   * @param {number} status - The HTTP status.
   * @param {string} error - Why.
   * @returns {null} So a check can `return refuse(...)`.
   */
  const refuse = (status, error) => {
    res.status(status).json({ error });
    return null;
  };
  // 501 Not Implemented: what the server doesn't support (yet), not a
  // fault in the request (RFC 9110, section 15.6.2).
  if (kind !== 'code' && kind !== 'fill-in-the-blank') {
    return refuse(501, `This server can't answer a question of this kind ("${kind}").`);
  }
  if (kind === 'fill-in-the-blank' && action === 'test') {
    return refuse(400, 'Test is for code questions only: a fill-in-the-blank question has no test cases to show.');
  }
  if (!SUPPORTED_LANGUAGES.includes(language)) {
    return refuse(400, `language must be one of: ${SUPPORTED_LANGUAGES.join(', ')}`);
  }
  if (kind === 'fill-in-the-blank') {
    const wrong = checkFillInTheBlankAnswer(answer, problem);
    if (wrong) return refuse(400, wrong);
  } else if (typeof code !== 'string' || (codeRequired && !code.trim())) {
    return refuse(400, codeRequired ? 'code is required' : 'code must be a string (it may be empty)');
  }
  // How long the learner took, from the problem page's timer (issue #20).
  // Optional, so a page loaded before the timer existed can still Submit;
  // the record then says null. It's what the browser reports, not measured
  // here (docs/plans/elapsed-timer.md, T6).
  if (elapsedMs !== undefined && !(Number.isSafeInteger(elapsedMs) && elapsedMs >= 0)) {
    return refuse(400, 'elapsedMs must be a whole number of milliseconds, 0 or more');
  }

  // A question's languages: a code question's starterCode keys, a
  // fill-in-the-blank question's template keys (#160, Q3, rule 4).
  const byLanguage = kind === 'code' ? problem.starterCode : problem.template;
  if (!(byLanguage && byLanguage[language])) {
    return refuse(400, `This problem doesn't support ${language}.`);
  }
  /** @type {CheckedRequest} */
  const checked = kind === 'code'
    ? { problem, sha256: loaded.sha256, email, language, kind, code, elapsedMs }
    : { problem, sha256: loaded.sha256, email, language, kind, answer: /** @type {{ blank: string }} */ (answer), elapsedMs };
  if (forTest) return checked;
  // The learner's profile decides which languages they may use (403
  // otherwise). An invalid profile refuses everything rather than guess
  // (fail closed): 500, naming the problem.
  let profile;
  try {
    profile = loadProfile(email);
  } catch (err) {
    sendProfileError(res, /** @type {Error & { code?: string }} */ (err));
    return null;
  }
  if (!profile.allowedLanguages.includes(language)) {
    return refuse(403, `${language} isn't one of the languages you can use (${profile.allowedLanguages.join(', ')}).`);
  }
  // Broken order.json or backlog.json: refused the same way (step 5,
  // decision 3).
  try {
    loadQueueFiles(email);
  } catch (err) {
    sendQueueError(res, /** @type {Error & { code?: string }} */ (err));
    return null;
  }
  return checked;
}

/**
 * A code question's Submit or Skip record, version 4 (readme.html, "Where
 * data lives"; docs/plans/submission-records-v4.md): version 3 with
 * schemaVersion 4 and kind "code" (D2). Version 3 (step 8, detail 6) added
 * skipped: "yes" on a Skip; a Submit leaves it out. A Skip isn't judged,
 * so its judging fields are null and results empty (D8).
 *
 * @param {CheckedRequest} request - What was asked: a code question's.
 * @param {string} submittedAt - When, as UTC ISO 8601.
 * @param {import('./judge/runner').JudgeResult | null} result - The judge's
 *   result, or null for a Skip.
 * @returns {import('./users').SubmissionRecord} The record to save.
 */
function submissionRecord({ problem, sha256, language, code, elapsedMs }, submittedAt, result) {
  return {
    // 2 added elapsedMs (2026-11-03), 3 skipped (step 8), 4 kind (#160).
    schemaVersion: 4,
    submittedAt,
    question: problem.slug,
    questionSha256: sha256,
    language,
    kind: 'code',
    judgeMode: problem.judgeMode || 'function',
    // A code question's request always has code (checkExecutionRequest).
    code: /** @type {string} */ (code),
    ...(result === null && { skipped: /** @type {'yes'} */ ('yes') }),
    status: result ? result.status : null,
    passed: result ? result.passed : null,
    total: result ? result.total : null,
    runtimeMs: result ? result.runtimeMs : null,
    elapsedMs: elapsedMs ?? null,
    results: result ? result.results.map((/** @type {{ passed: boolean }} */ r) => r.passed) : [],
    stdout: result ? result.stdout : null,
    stderr: result ? result.stderr : null,
  };
}

/**
 * A fill-in-the-blank question's Submit or Skip record, version 4
 * (docs/plans/submission-records-v4.md): kind (D2); the answer as the
 * server checked it, and no code or judgeMode (D1); the judge's message
 * and hints when it gave them (D3); judgeSha256 beside questionSha256
 * (D6); and null for what this judge doesn't produce, as for a Skip (D4).
 * A Skip keeps what the box held as answer, and has skipped: "yes".
 *
 * @param {CheckedRequest} request - What was asked: a fill-in-the-blank
 *   question's.
 * @param {string} submittedAt - When, as UTC ISO 8601.
 * @param {{ status: string, message?: string, hints?: string[] } | null} verdict -
 *   The judge's result, or null for a Skip.
 * @param {string | null} judgeSha256 - The judge file's SHA-256 as loaded,
 *   from judgeSha256Of; null for a Skip, which judges nothing and so never
 *   loads the judge (owner, 2026-11-09, option A: a broken judge can't
 *   block a Skip).
 * @returns {import('./users').SubmissionRecord} The record to save.
 */
function fillInTheBlankRecord({ problem, sha256, language, answer, elapsedMs }, submittedAt, verdict, judgeSha256) {
  return {
    schemaVersion: 4,
    submittedAt,
    question: problem.slug,
    questionSha256: sha256,
    // null for a Skip, which judges nothing (owner, 2026-11-09, option A).
    judgeSha256,
    language,
    kind: 'fill-in-the-blank',
    // A fill-in-the-blank question's request always has answer, checked
    // (checkExecutionRequest).
    answer: /** @type {{ blank: string }} */ (answer),
    ...(verdict === null && { skipped: /** @type {'yes'} */ ('yes') }),
    status: verdict ? verdict.status : null,
    ...(verdict && verdict.message !== undefined && { message: verdict.message }),
    ...(verdict && verdict.hints !== undefined && { hints: verdict.hints }),
    passed: null,
    total: null,
    runtimeMs: null,
    elapsedMs: elapsedMs ?? null,
    results: [],
    stdout: null,
    stderr: null,
  };
}

/**
 * Saves a Submit's record. A failed save mustn't cost the learner their
 * result, so it's reported alongside it instead, and logged.
 *
 * @param {string} email - The learner.
 * @param {string} slug - The question, for the log.
 * @param {import('./users').SubmissionRecord} record - What to save.
 * @returns {Promise<{ submissionId?: string, saved: boolean, saveError?: string }>}
 *   saved, with submissionId or saveError, in the order the answer has
 *   always had them.
 */
async function saveRecord(email, slug, record) {
  try {
    // saveSubmission checks the user again.
    const submissionId = await saveSubmission(email, record);
    return { submissionId, saved: true };
  } catch (err) {
    console.error(`Failed to save submission for ${slug}:`, err);
    return { saved: false, saveError: publicMessage(/** @type {Error} */ (err), SERVER_PROBLEM) };
  }
}

/**
 * Moves the pair through the queue after a saved Submit (D3). Like a
 * failed save, a failed update doesn't cost the learner their result (step
 * 6, detail 5). Synchronous, and called with no await between it and the
 * response: see updateQueue().
 *
 * @param {string} email - The learner.
 * @param {{ question: string, language: string }} pair - The pair.
 * @param {'yes' | 'no'} pass - passFor()'s verdict.
 * @returns {{ queueUpdated: boolean, queueError?: string }} What happened,
 *   for the answer.
 */
function moveQueue(email, pair, pass) {
  try {
    updateQueue(email, pair, pass);
    return { queueUpdated: true };
  } catch (err) {
    console.error(`Queue not updated for ${pair.question} in ${pair.language}: ${/** @type {Error} */ (err).message}`);
    return { queueUpdated: false, queueError: publicMessage(/** @type {Error} */ (err), SERVER_PROBLEM) };
  }
}

/**
 * Handles Run (visible test cases only), Submit (all of them, then saves
 * a record and moves the queue) and Test (issue #58: all of them, the
 * hidden ones' details shown, and nothing saved or moved). Refuses what
 * checkExecutionRequest() refuses; 503 when the judge is unavailable or
 * busy; otherwise the judge's result, with pass ("yes" or "no", passFor's
 * verdict), saved/submissionId (or saveError) and queueUpdated (or
 * queueError) for a Submit, and tested: true for a Test. A
 * fill-in-the-blank question's Run (the only one it takes so far) is
 * judged by judgeFillInTheBlank: { status, message?, hints? }, nothing
 * recorded. A failed judging is answered by sendJudgeError().
 *
 * @param {AppRequest} req - The request; its body should be
 *   { language, code, elapsedMs? }, or { language, answer } for a
 *   fill-in-the-blank question.
 * @param {Response} res - The response.
 * @param {{ mode: 'run' | 'submit' | 'test' }} options - Which it is.
 * @returns {Promise<Response | void>} Nothing that's used: the
 *   `return res...` lines only stop early.
 */
async function handleExecution(req, res, { mode }) {
  const request = checkExecutionRequest(req, res, { codeRequired: true, action: mode });
  if (!request) return;
  const { problem, email, language } = request;

  // A fill-in-the-blank question (Run or Submit; checkExecutionRequest
  // refuses Test): judged by its own judge, in this process, synchronously
  // (no sandbox or queue: nothing the learner typed is run). Its result is
  // status, message and hints (contract 2). A judge that fails throws
  // before anything is saved, so nothing is recorded and the queue doesn't
  // move (Q9a).
  if (request.kind === 'fill-in-the-blank') {
    const submittedAt = new Date().toISOString();
    /** @type {{ status: string, message?: string, hints?: string[] }} */
    let verdict;
    /** @type {string} */
    let judgeSha256;
    try {
      ({ verdict, judgeSha256 } = judgeWithHash(problem, /** @type {{ blank: string }} */ (request.answer), language));
    } catch (err) {
      return sendJudgeError(res, /** @type {JudgeError} */ (err), problem.slug, language);
    }
    if (mode === 'run') return res.json(verdict);
    const pass = passFor(verdict.status);
    /** @type {{ status: string, message?: string, hints?: string[], pass?: 'yes' | 'no', saved?: boolean, submissionId?: string, saveError?: string, queueUpdated?: boolean, queueError?: string }} */
    const answer = { ...verdict, pass };
    Object.assign(answer, await saveRecord(email, problem.slug, fillInTheBlankRecord(request, submittedAt, verdict, judgeSha256)));
    if (answer.saved) Object.assign(answer, moveQueue(email, { question: problem.slug, language }, pass));
    return res.json(answer);
  }
  // A code question's, checked by checkExecutionRequest.
  const code = /** @type {string} */ (request.code);

  const judgeMode = problem.judgeMode || 'function';
  // A function-mode question always has functionName (the problem file
  // format); one without would throw here, as before.
  const functionName = judgeMode === 'function' ? /** @type {Record<string, string>} */ (problem.functionName)[language] : undefined;
  // Test gives the judge copies with hidden taken off, so it sends back
  // every case's details (playtest.js, detail 4).
  const testCases = mode === 'run' ? problem.testCases.filter((tc) => !tc.hidden)
    : mode === 'test' ? revealHidden(problem.testCases)
      : problem.testCases;
  const signature = problem.signature && problem.signature[language];

  try {
    const submittedAt = new Date().toISOString();
    // Submit adds whether it passed, then what happened to its record:
    // saved, then submissionId or saveError.
    const result = /** @type {import('./judge/runner').JudgeResult & { pass?: 'yes' | 'no', saved?: boolean, submissionId?: string, saveError?: string, queueUpdated?: boolean, queueError?: string, tested?: boolean }} */ (
      await runSubmission({ language, code, functionName, testCases, signature, judgeMode })
    );
    // Test: the hidden cases marked again, and nothing saved or moved
    // (issue #58, details 3 and 4).
    if (mode === 'test') {
      result.results = markRevealed(result.results, problem.testCases);
      result.tested = true;
    }
    // Only Submit is recorded (Run and Test aren't). A failed save mustn't
    // cost the learner their result, so it's reported alongside it instead.
    if (mode === 'submit') {
      // The page turns Submit into Next only on a pass (D7, as changed on
      // 2026-11-07), so it's told the verdict the queue uses, from the one
      // function that decides it, rather than working it out again.
      const pass = passFor(result.status);
      result.pass = pass;
      Object.assign(result, await saveRecord(email, problem.slug, submissionRecord(request, submittedAt, result)));
      // Only a saved Submit moves the queue (D3). No await from here to
      // the response: see updateQueue().
      if (result.saved) Object.assign(result, moveQueue(email, { question: problem.slug, language }, pass));
    }
    res.json(result);
  } catch (err) {
    sendJudgeError(res, /** @type {JudgeError} */ (err), problem.slug, language);
  }
}

/**
 * Judges a fill-in-the-blank answer (judgeFillInTheBlank, questions'), and
 * gives the SHA-256 of the judge file as it was loaded, for the record
 * (D6; owner, 2026-11-09, option b: hashed at load, so it's always the
 * code that judged, which a per-request hash isn't once Node has cached
 * the judge and the file then changes). The hash comes from questions'
 * judgeSha256Of (#208), asked after judging, so the judge it names is the
 * one already loaded.
 *
 * @param {Problem} problem - The fill-in-the-blank question.
 * @param {{ blank: string }} answer - The answer, checked.
 * @param {string} language - Its language.
 * @returns {{ verdict: { status: string, message?: string, hints?: string[] }, judgeSha256: string }}
 *   The verdict, for the page and the record, and the hash, for the record only.
 * @throws {Error} What judgeFillInTheBlank or judgeSha256Of throws:
 *   'JUDGE_FAILED' for a judge that failed or can't be loaded (contract 2).
 */
function judgeWithHash(problem, answer, language) {
  const verdict = judgeFillInTheBlank(problem, answer, language);
  return { verdict, judgeSha256: judgeSha256Of(problem) };
}

/** What the page shows for a judge that failed (contract 2; #160's Q9a). @type {string} */
const COULDNT_JUDGE = "We couldn't judge this answer; it wasn't recorded.";

/**
 * The answer to a judging that threw, by the error's code (contract 2:
 * matched as strings, not classes):
 * - 'SANDBOX_UNAVAILABLE' and 'JUDGE_BUSY': 503 Service Unavailable, the
 *   server is fine but judging is off until its sandbox works
 *   (judge/sandbox.js), or the judge's queue is full for now
 *   (judge/queue.js), with retryAfterSeconds for Retry-After (RFC 9110,
 *   section 10.2.3);
 * - 'JUDGE_FAILED', a fill-in-the-blank judge that failed: 500 with
 *   COULDNT_JUDGE (owner, 2026-11-09: a fault on the server, RFC 9110,
 *   section 15.6.1). Its details are in the server's log, never sent;
 * - anything else: 500, "Execution failed", as before.
 *
 * @param {JudgeError} err - What judging threw.
 * @returns {{ status: number, error: string, retryAfterSeconds?: number }}
 *   The HTTP status, the message for the page, and for 'JUDGE_BUSY' how
 *   many seconds to wait.
 */
function judgeErrorAnswer(err) {
  if (err.code === 'SANDBOX_UNAVAILABLE') return { status: 503, error: err.message };
  if (err.code === 'JUDGE_BUSY') return { status: 503, error: err.message, retryAfterSeconds: err.retryAfterSeconds };
  if (err.code === 'JUDGE_FAILED') return { status: 500, error: COULDNT_JUDGE };
  return { status: 500, error: `Execution failed: ${SERVER_PROBLEM}` };
}

/**
 * Sends judgeErrorAnswer()'s answer, with Retry-After when it has one, and
 * logs a 500 that isn't 'JUDGE_FAILED' (judgeFillInTheBlank logs those
 * itself, with the details).
 *
 * @param {Response} res - The response.
 * @param {JudgeError} err - What judging threw.
 * @param {string} slug - The question, for the log.
 * @param {string} language - The language, for the log.
 * @returns {Response} The response, sent.
 */
function sendJudgeError(res, err, slug, language) {
  const { status, error, retryAfterSeconds } = judgeErrorAnswer(err);
  if (retryAfterSeconds !== undefined) res.set('Retry-After', String(retryAfterSeconds));
  if (status === 500 && err.code !== 'JUDGE_FAILED') console.error(`Judging failed for ${slug} in ${language}: ${err.message}`);
  return res.status(status).json({ error });
}

router.post(
  '/api/questions/:slug/run',
  /**
   * POST /api/questions/:slug/run: handleExecution() on the visible test cases.
   *
   * @param {AppRequest} req - Body { language, code }.
   * @param {Response} res - Answered by handleExecution().
   * @returns {Promise<Response | void>} Nothing that's used.
   */
  (req, res) => handleExecution(req, res, { mode: 'run' }),
);
router.post(
  '/api/questions/:slug/submit',
  /**
   * POST /api/questions/:slug/submit: handleExecution() on every test case,
   * then saved.
   *
   * @param {AppRequest} req - Body { language, code, elapsedMs? }.
   * @param {Response} res - Answered by handleExecution().
   * @returns {Promise<Response | void>} Nothing that's used.
   */
  (req, res) => handleExecution(req, res, { mode: 'submit' }),
);
router.post(
  '/api/questions/:slug/test',
  /**
   * POST /api/questions/:slug/test (issue #58): handleExecution() on every
   * test case, hidden ones shown in full, nothing saved. The owner only:
   * anyone else gets 403 before anything else is looked at (detail 2).
   *
   * @param {AppRequest} req - Body { language, code }.
   * @param {Response} res - Answered by handleExecution(), or 403 here.
   * @returns {Promise<Response | void> | Response} Nothing that's used.
   */
  (req, res) => {
    if (!canTestQuestions(req.userEmail, OWNER_EMAIL)) return res.status(403).json({ error: 'Only the owner can Test questions.' });
    return handleExecution(req, res, { mode: 'test' });
  },
);

/**
 * Handles Skip (step 8; D8): saves a Skip record, then moves the pair as a
 * failed Submit would (recordSubmit() with pass "no"), and answers with
 * what's next, so the page can go straight there (detail 2). Refuses what
 * checkExecutionRequest() refuses, with code allowed to be empty. A pair
 * with passesInARow above 0 needs confirmed: true, or it's 409 with
 * { code: "CONFIRM_STREAK", passesInARow } and nothing changes (detail 1).
 * That check reads order.json before the record is saved (an await), so
 * it's a preflight; the queue change itself is updateQueue()'s, with no
 * await.
 *
 * @param {AppRequest} req - The request; its body should be
 *   { language, code, elapsedMs?, confirmed? }.
 * @param {Response} res - { saved, submissionId?, saveError?, queueUpdated?,
 *   queueError?, next?, nextError? }.
 * @returns {Promise<Response | void>} Nothing that's used: the
 *   `return res...` lines only stop early.
 */
async function handleSkip(req, res) {
  const { confirmed } = req.body || {};
  if (confirmed !== undefined && typeof confirmed !== 'boolean') {
    return res.status(400).json({ error: 'confirmed must be true or false' });
  }
  const request = checkExecutionRequest(req, res, { codeRequired: false, action: 'skip' });
  if (!request) return;
  const { problem, email, language } = request;
  const pair = { question: problem.slug, language };

  let element;
  try {
    element = loadQueueFiles(email).order.queue.find((e) => e.question === pair.question && e.language === pair.language);
  } catch (err) {
    return sendQueueError(res, /** @type {Error & { code?: string }} */ (err));
  }
  if (element && element.passesInARow > 0 && confirmed !== true) {
    const n = element.passesInARow;
    return res.status(409).json({
      error: `Skipping resets your ${n} ${n === 1 ? 'pass' : 'passes'} in a row; send confirmed: true to skip anyway.`,
      code: 'CONFIRM_STREAK',
      passesInARow: n,
    });
  }

  /** @type {{ saved: boolean, submissionId?: string, saveError?: string, queueUpdated?: boolean, queueError?: string, next?: (import('./order').BacklogElement & { title: string }) | null, nextError?: string }} */
  const answer = { saved: false };
  const skippedAt = new Date().toISOString();
  // By kind (records version 4): a fill-in-the-blank Skip keeps what the
  // box held as its answer (D1).
  const record = request.kind === 'fill-in-the-blank'
    ? fillInTheBlankRecord(request, skippedAt, null, null)
    : submissionRecord(request, skippedAt, null);
  try {
    answer.submissionId = await saveSubmission(email, record);
    answer.saved = true;
  } catch (err) {
    console.error(`Failed to save skip for ${problem.slug}:`, err);
    answer.saveError = publicMessage(/** @type {Error} */ (err), SERVER_PROBLEM);
    return res.json(answer); // nothing changed: the page stays (detail 3a)
  }
  // From here to the response, no await (updateQueue()).
  try {
    updateQueue(email, pair, 'no');
    answer.queueUpdated = true;
  } catch (err) {
    console.error(`Queue not updated for ${problem.slug} in ${language}: ${/** @type {Error} */ (err).message}`);
    answer.queueUpdated = false;
    answer.queueError = publicMessage(/** @type {Error} */ (err), SERVER_PROBLEM);
  }
  try {
    answer.next = workOutNext(email);
  } catch (err) {
    console.error(`Next not worked out after a Skip of ${problem.slug} in ${language}: ${/** @type {Error} */ (err).message}`);
    answer.nextError = publicMessage(/** @type {Error} */ (err), SERVER_PROBLEM);
  }
  res.json(answer);
}

router.post(
  '/api/questions/:slug/skip',
  /**
   * POST /api/questions/:slug/skip: handleSkip().
   *
   * @param {AppRequest} req - Body { language, code, elapsedMs?, confirmed? }.
   * @param {Response} res - Answered by handleSkip().
   * @returns {Promise<Response | void>} Nothing that's used.
   */
  (req, res) => handleSkip(req, res),
);

// --- Saved submissions (the signed-in user's own) --------------------------------
// Express 4 doesn't catch errors from async handlers, hence the try/catch.

/**
 * A summary for a list: everything except code, stdout and stderr.
 * elapsedMs is null for records without it (schemaVersion 1, or a page
 * that didn't send it).
 *
 * @param {SavedSubmission} record - A saved Submit.
 * @returns {SubmissionSummary} Its summary.
 */
function toSubmissionSummary({ id, submittedAt, question, language, kind, status, passed, total, runtimeMs, elapsedMs, skipped, answer, message }) {
  return {
    id, submittedAt, question, language,
    // Records before version 4 have no kind: they're all code questions'.
    kind: kind ?? 'code',
    status, passed, total, runtimeMs, elapsedMs: elapsedMs ?? null,
    ...(skipped === 'yes' && { skipped }),
    // A fill-in-the-blank answer: what was typed, for the Submissions tab
    // (owner, 2026-11-09). A code record's code stays out of summaries.
    ...(answer !== undefined && { answer }),
    // The judge's message, for the Submissions tab (records v4, D3).
    ...(message !== undefined && { message }),
  };
}

// Newest first. Optional ?question=<slug> and ?language=<language> narrow
// it down. Progress is per (question, language), so the problem page asks
// for exactly one pair.
router.get(
  '/api/submissions',
  /**
   * GET /api/submissions: the user's saved Submits, as summaries.
   *
   * @param {AppRequest} req - ?question= and ?language=, each optional.
   * @param {Response} res - SubmissionSummary[], newest first; 400 for a bad
   *   query; 500 if they can't be read.
   * @returns {Promise<Response | void>} Nothing that's used.
   */
  async (req, res) => {
    const { question, language } = req.query;
    if (question !== undefined && typeof question !== 'string') {
      return res.status(400).json({ error: 'question must be given at most once' });
    }
    if (language !== undefined && !(typeof language === 'string' && SUPPORTED_LANGUAGES.includes(language))) {
      return res.status(400).json({ error: `language must be given at most once, as one of: ${SUPPORTED_LANGUAGES.join(', ')}` });
    }
    try {
      const records = await listSubmissions(/** @type {string} */ (req.userEmail)); // signed in: the gate
      res.json(
        records
          .filter((r) => (!question || r.question === question) && (!language || r.language === language))
          .map(toSubmissionSummary)
      );
    } catch (err) {
      console.error(`Submissions not listed: ${/** @type {Error} */ (err).message}`);
      res.status(500).json({ error: `Could not read submissions: ${SERVER_PROBLEM}` });
    }
  },
);

// One submission in full, including code, stdout and stderr.
router.get(
  '/api/submissions/:id',
  /**
   * GET /api/submissions/:id: one saved Submit in full.
   *
   * @param {AppRequest} req - req.params.id is its id.
   * @param {Response} res - The record, or 404; 500 if it can't be read.
   * @returns {Promise<Response | void>} Nothing that's used.
   */
  async (req, res) => {
    try {
      const record = await loadSubmission(/** @type {string} */ (req.userEmail), req.params.id); // signed in: the gate
      if (!record) return res.status(404).json({ error: 'Submission not found' });
      res.json(record);
    } catch (err) {
      console.error(`Submission not read: ${/** @type {Error} */ (err).message}`);
      res.status(500).json({ error: `Could not read submission: ${SERVER_PROBLEM}` });
    }
  },
);

// --- The learner's profile (spaced-repetition plan, D2) -------------------------

/**
 * The signed-in user's effective profile, from users/<email>/profile.json.
 *
 * @param {string} email - The user's email.
 * @returns {import('./profile').EffectiveProfile} The profile to use.
 * @throws {Error} ProfileError (code INVALID_PROFILE) if the file is
 *   invalid; another Error if it can't be read.
 */
function loadProfile(email) {
  return parseProfile(readProfileFile(email));
}

/**
 * The profile as the page gets it (GET /api/profile, PATCH
 * /api/profile/preferred): the effective profile plus canTestQuestions,
 * whether the Test button is shown (issue #58), and canSeeQuestionBank,
 * whether the list links to the question bank (#133). Both answers carry
 * them, since the page replaces its copy with either.
 *
 * @param {string} email - The signed-in user.
 * @param {import('./profile').EffectiveProfile} profile - Their profile.
 * @returns {import('./profile').EffectiveProfile & { canTestQuestions: boolean, canSeeQuestionBank: boolean }} The answer.
 */
function profileForPage(email, profile) {
  return { ...profile, canTestQuestions: canTestQuestions(email, OWNER_EMAIL), canSeeQuestionBank: canSeeQuestionBank(email) };
}

// What the browser is told when something fails on the server for a reason
// other than a learner's invalid file: never the error's own message, which
// can carry a path on the server (a file that can't be read or written).
// The details go to the server's log instead (OWASP, Error Handling Cheat
// Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html).
const SERVER_PROBLEM = 'a problem on the server (its log has the details)';

// Error codes whose message the browser may see: each describes what's wrong
// in the learner's own profile.json, order.json or backlog.json (profile.js,
// order.js), which they or the owner must fix, and names no path.
const SHOWN_CODES = new Set(['INVALID_PROFILE', 'INVALID_QUEUE']);

/**
 * What an error may tell the browser: its own message if its code is one
 * of SHOWN_CODES, otherwise `fallback`. Log the full message where it's
 * caught.
 *
 * @param {Error & { code?: string }} err - The error.
 * @param {string} fallback - What to say instead, for any other error.
 * @returns {string} The message to send.
 */
function publicMessage(err, fallback) {
  return err.code !== undefined && SHOWN_CODES.has(err.code) ? err.message : fallback;
}

/**
 * Answers a request that a profile problem stopped: 500 for an invalid
 * profile.json (the server's data, not the request, is wrong) or one that
 * can't be read, and logs it, since the owner has to fix the file.
 *
 * @param {Response} res - The response.
 * @param {Error & { code?: string }} err - From loadProfile() or
 *   applyPreferredChange().
 * @returns {Response} The response, sent.
 */
function sendProfileError(res, err) {
  console.error(`Profile problem: ${err.message}`);
  return res.status(500).json({ error: publicMessage(err, `Your profile couldn't be read: ${SERVER_PROBLEM}`), code: err.code === 'INVALID_PROFILE' ? 'INVALID_PROFILE' : undefined });
}

// The effective profile: allowedLanguages, languages (turned on, in order),
// defaultLanguage and the three can... permissions.
router.get(
  '/api/profile',
  /**
   * GET /api/profile: the user's effective profile.
   *
   * @param {AppRequest} req - The request.
   * @param {Response} res - The EffectiveProfile, or 500 if profile.json is invalid.
   * @returns {void}
   */
  (req, res) => {
    try {
      res.json(profileForPage(/** @type {string} */ (req.userEmail), loadProfile(/** @type {string} */ (req.userEmail)))); // signed in: the gate
    } catch (err) {
      sendProfileError(res, /** @type {Error & { code?: string }} */ (err));
    }
  },
);

// The learner changes their own choices: body { languages?, defaultLanguage? }.
// Only preferred changes (profile.js, applyPreferredChange): 403 when an
// allowed flag forbids it, 400 when it doesn't fit allowed. Read, changed
// and written with no await in between (synchronous file calls), so two at
// once can't overwrite each other's change. Answers the new effective profile.
router.patch(
  '/api/profile/preferred',
  /**
   * PATCH /api/profile/preferred: the learner changes their own choices.
   *
   * @param {AppRequest} req - Body { languages?, defaultLanguage? }.
   * @param {Response} res - The new EffectiveProfile; 403 if not permitted,
   *   400 if it doesn't fit, 500 if profile.json is invalid.
   * @returns {Response | void} Nothing that's used.
   */
  (req, res) => {
    const email = /** @type {string} */ (req.userEmail); // signed in: the gate
    let contents;
    try {
      const text = readProfileFile(email);
      let raw;
      try {
        raw = text === undefined ? undefined : JSON.parse(text);
      } catch {
        // Not JSON: parseProfile says so, as an invalid profile.
        parseProfile(/** @type {string} */ (text));
      }
      contents = applyPreferredChange(raw, req.body || {});
    } catch (err) {
      const { code, message } = /** @type {Error & { code?: string }} */ (err);
      if (code === 'NOT_PERMITTED') return res.status(403).json({ error: message });
      if (code === 'INVALID_CHANGE') return res.status(400).json({ error: message });
      return sendProfileError(res, /** @type {Error & { code?: string }} */ (err));
    }
    try {
      writeProfileFile(email, contents);
      res.json(profileForPage(email, parseProfile(readProfileFile(email))));
    } catch (err) {
      sendProfileError(res, /** @type {Error} */ (err));
    }
  },
);

// What to open next (spaced-repetition plan, step 7; D7): the front of the
// queue that can be opened, else the backlog's (detail 3). Safe, as a GET
// should be (RFC 9110, section 9.2.1): the backlog is filled in memory
// only, as it would be at start (detail 4), and nothing is written.
router.get(
  '/api/next',
  /**
   * GET /api/next: { next: { question, language, title } }, or
   * { next: null } if nothing can be opened (detail 1).
   *
   * @param {AppRequest} req - The request.
   * @param {Response} res - The answer, or 500 if the profile, a queue file
   *   or a question file is invalid.
   * @returns {Response | void} Nothing that's used: the `return res...`
   *   lines only stop early.
   */
  (req, res) => {
    try {
      res.json({ next: workOutNext(/** @type {string} */ (req.userEmail)) }); // signed in: the gate
    } catch (err) {
      return sendViewError(res, /** @type {Error & { code?: string }} */ (err), 'Next not worked out');
    }
  },
);

// The problem list (spaced-repetition plan, step 9; D7): the pairs that can
// be opened, queue first, then backlog. Safe, like GET /api/next: the
// backlog is filled in memory only, and nothing is written.
router.get(
  '/api/queue',
  /**
   * GET /api/queue: { pairs: [{ question, language, where, pass?,
   * passesInARow?, title, difficulty, topics, sources }] }, next first.
   *
   * @param {AppRequest} req - The request.
   * @param {Response} res - The list, or 500 if the profile, a queue file
   *   or a question file is invalid.
   * @returns {Response | void} Nothing that's used.
   */
  (req, res) => {
    try {
      const { order, backlog, canOpen, questionOf } = queueView(/** @type {string} */ (req.userEmail)); // signed in: the gate
      res.json({
        pairs: listPairs(order, backlog, canOpen).map(
          /**
           * Adds what the list shows of the pair's question.
           *
           * @param {import('./order').ListedPair} p - A pair.
           * @returns {import('./order').ListedPair & Pick<Problem, 'title' | 'difficulty' | 'topics' | 'sources'>} The line.
           */
          (p) => {
            const { title, difficulty, topics, sources } = questionOf(p.question);
            return { ...p, title, difficulty, topics, sources };
          },
        ),
      });
    } catch (err) {
      return sendViewError(res, /** @type {Error & { code?: string }} */ (err), 'Queue not listed');
    }
  },
);

// The question bank (#133): the owner only (canSeeQuestionBank), and safe,
// like GET /api/queue: nothing is written.
router.get(
  '/api/question-bank',
  /**
   * GET /api/question-bank: { languages, questions } (questionBank()), or
   * 403 for anyone canSeeQuestionBank() refuses.
   *
   * @param {AppRequest} req - The request.
   * @param {Response} res - The bank; 403; or 500 if the profile, a queue
   *   file or a question file is invalid.
   * @returns {Response | void} Nothing that's used.
   */
  (req, res) => {
    if (!canSeeQuestionBank(req.userEmail)) return res.status(403).json({ error: 'Only the owner can see the question bank.' });
    try {
      res.json(questionBank(/** @type {string} */ (req.userEmail))); // signed in: the gate
    } catch (err) {
      return sendViewError(res, /** @type {Error & { code?: string }} */ (err), 'Question bank not listed');
    }
  },
);

/**
 * What to open next for a user (step 7): nextPair() over their files, the
 * backlog filled in memory only (detail 4), with canOpenPair(). Writes
 * nothing. Used by GET /api/next and by Skip's answer.
 *
 * @param {string} email - The user's email.
 * @returns {(import('./order').BacklogElement & { title: string }) | null}
 *   The pair and its question's title, or null if nothing can be opened.
 * @throws {Error} ProfileError (INVALID_PROFILE) or QueueFileError
 *   (INVALID_QUEUE) for an invalid file; another Error if a file can't be
 *   read, or a question file is invalid.
 */
function workOutNext(email) {
  const { order, backlog, canOpen, questionOf } = queueView(email);
  const next = nextPair(order, backlog, canOpen);
  return next && { ...next, title: questionOf(next.question).title };
}

/**
 * A user's queue and backlog as Next and the problem list see them (steps
 * 7 and 9): the backlog filled in memory only (step 7, detail 4), the
 * canOpenPair() test, and a way to look up a question. Writes nothing.
 * Also the profile and the questions it was worked out from, for the
 * question bank (#133).
 *
 * @param {string} email - The user's email.
 * @returns {{ order: import('./order').OrderFile, backlog: import('./order').BacklogFile,
 *   canOpen: (pair: import('./order').BacklogElement) => boolean,
 *   questionOf: (slug: string) => QuestionListing,
 *   profile: import('./profile').EffectiveProfile, questions: QuestionListing[] }} The view.
 *   questionOf() is only for a pair canOpen() accepted, whose question is known.
 * @throws {Error} ProfileError (INVALID_PROFILE) or QueueFileError
 *   (INVALID_QUEUE) for an invalid file; another Error if a file can't be
 *   read, or a question file is invalid.
 */
function queueView(email) {
  const profile = loadProfile(email);
  const files = loadQueueFiles(email);
  const questions = questionInfos();
  const bySlug = new Map(questions.map((q) => [q.slug, q]));
  return {
    order: files.order,
    backlog: fillBacklog(files.order, files.backlog, backlogPairs(questions, profile)).backlog,
    canOpen: canOpenPair(profile, questions),
    // canOpenPair() accepts only pairs whose question is in questions.
    questionOf: (slug) => /** @type {QuestionListing} */ (bySlug.get(slug)),
    profile,
    questions,
  };
}

// --- The question bank (issue #133; docs/plans/question-bank-page.md) -------

/**
 * Whether a user may see the question bank: every question, and where each
 * of its pairs is in their own queue and backlog (#133, Q2). Today only
 * the owner (MAXRECALL_USER, users.js), as for Test, but a rule of its
 * own, so the two can part later (a teacher).
 *
 * @param {string | null | undefined} email - The signed-in user
 *   (req.userEmail, which the gate sets), or null or undefined if none.
 * @returns {boolean} True only for OWNER_EMAIL; false for anything else,
 *   null, undefined and '' included.
 */
function canSeeQuestionBank(email) {
  return typeof email === 'string' && email !== '' && email === OWNER_EMAIL;
}

/**
 * Where one pair is, for the question bank.
 *
 * @typedef {object} BankPair
 * @property {'queue' | 'backlog'} where - The file it's in.
 * @property {number} [position] - In the queue and listed: its number on
 *   the problem list (1 is next), counted, as the list counts, over the
 *   pairs the list shows.
 * @property {boolean} listed - Whether the problem list shows it:
 *   false for a language turned off (canOpenPair()).
 */

/**
 * One question in the question bank.
 *
 * @typedef {object} BankQuestion
 * @property {string} slug - Its file name without .json.
 * @property {string} created - UTC ISO 8601, from the file.
 * @property {string[]} languages - The languages it has (its starterCode's).
 * @property {string} title
 * @property {string} difficulty
 * @property {string[]} topics
 * @property {string[]} sources
 * @property {Record<string, BankPair>} pairs - By language, the pairs in
 *   the queue or backlog; a language in neither file isn't there.
 */

/**
 * The question bank for one user (#133): every question in questions/, by
 * created then slug, each with where its pairs are in the user's queue and
 * backlog, as GET /api/queue sees them (the backlog filled in memory for
 * "all"), but a pair in a language turned off is shown too (listed:
 * false). Writes nothing.
 *
 * @param {string} email - The user.
 * @returns {{ languages: string[], questions: BankQuestion[] }} languages:
 *   the columns, the allowed languages, those turned on first, in the
 *   learner's order.
 * @throws {Error} As queueView() does.
 */
function questionBank(email) {
  const { order, backlog, canOpen, profile, questions } = queueView(email);
  /** @type {Map<string, BankPair>} */
  const where = new Map();
  let position = 0;
  for (const e of order.queue) {
    const listed = canOpen(e);
    if (listed) position += 1;
    where.set(`${e.question}/${e.language}`, { where: 'queue', ...(listed && { position }), listed });
  }
  for (const p of backlog.backlog) {
    where.set(`${p.question}/${p.language}`, { where: 'backlog', listed: canOpen(p) });
  }
  const languages = [...profile.languages, ...profile.allowedLanguages.filter((l) => !profile.languages.includes(l))];
  const sorted = [...questions].sort((a, b) => (a.created < b.created ? -1 : a.created > b.created ? 1 : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return {
    languages,
    questions: sorted.map(
      /**
       * One question's line: what the list shows of it, and its pairs.
       *
       * @param {QuestionListing} q - The question.
       * @returns {BankQuestion} Its line.
       */
      (q) => {
        /** @type {Record<string, BankPair>} */
        const pairs = {};
        for (const language of q.languages) {
          const found = where.get(`${q.slug}/${language}`);
          if (found) pairs[language] = found;
        }
        const { slug, created, title, difficulty, topics, sources } = q;
        return { slug, created, languages: q.languages, title, difficulty, topics, sources, pairs };
      },
    ),
  };
}

/**
 * Answers a request that a queue view stopped: the profile's or the
 * queue's 500, or a plain 500 for anything else (logged as `what`).
 *
 * @param {Response} res - The response.
 * @param {Error & { code?: string }} err - From queueView().
 * @param {string} what - What couldn't be done, for the log.
 * @returns {Response} The response, sent.
 */
function sendViewError(res, err, what) {
  if (err.code === 'INVALID_PROFILE') return sendProfileError(res, err);
  if (err.code === 'INVALID_QUEUE') return sendQueueError(res, err);
  console.error(`${what}: ${err.message}`);
  return res.status(500).json({ error: `${what}: ${SERVER_PROBLEM}` });
}

// --- The learner's queue and backlog (spaced-repetition plan, D1, D5, D6) ---

/**
 * A user's order.json and backlog.json, checked together (order.js).
 *
 * @param {string} email - The user's email.
 * @returns {{ order: import('./order').OrderFile, backlog: import('./order').BacklogFile }}
 *   Both; a missing file reads as an empty queue or backlog.
 * @throws {Error} QueueFileError (code INVALID_QUEUE) if either is invalid,
 *   or a pair is in both; another Error if one can't be read.
 */
function loadQueueFiles(email) {
  return parseQueueFiles(readUserFile(email, 'order.json'), readUserFile(email, 'backlog.json'));
}

/**
 * Answers a request that a queue problem stopped: 500, as for the profile
 * (sendProfileError), and logs it, since the owner has to fix the file.
 *
 * @param {Response} res - The response.
 * @param {Error & { code?: string }} err - From loadQueueFiles().
 * @returns {Response} The response, sent.
 */
function sendQueueError(res, err) {
  console.error(`Queue problem: ${err.message}`);
  return res.status(500).json({ error: publicMessage(err, `Your queue couldn't be read: ${SERVER_PROBLEM}`), code: err.code === 'INVALID_QUEUE' ? 'INVALID_QUEUE' : undefined });
}

/** @typedef {import('./question-files').QuestionListing} QuestionListing */

/**
 * Gives one user an order.json and a backlog.json holding every pair their
 * profile allows (step 5, decision 4; D6): with neither file, an empty
 * queue and a full backlog; otherwise the pairs in neither file are
 * appended to the backlog. With a chosen backlog (profile.json's backlog
 * "chosen", step 13) nothing is appended: a missing file is written empty.
 * order.js's backlogPairs() is the rule. A file is written only if it's
 * new or has changed.
 *
 * @param {string} email - The user's email.
 * @param {import('./order').QuestionInfo[]} questions - From questionInfos().
 * @returns {string} What was done, for the log, e.g. "0 in order.json, 26
 *   in backlog.json (26 added)".
 * @throws {Error} ProfileError or QueueFileError if a file is invalid
 *   (nothing is written then); another Error if one can't be read or written.
 */
function prepareUserQueues(email, questions) {
  const orderText = readUserFile(email, 'order.json');
  const backlogText = readUserFile(email, 'backlog.json');
  const { order, backlog } = parseQueueFiles(orderText, backlogText);
  const filled = fillBacklog(order, backlog, backlogPairs(questions, loadProfile(email)));
  if (orderText === undefined) writeUserFile(email, 'order.json', order);
  if (backlogText === undefined || filled.added > 0) writeUserFile(email, 'backlog.json', filled.backlog);
  return `${order.queue.length} in order.json, ${filled.backlog.backlog.length} in backlog.json (${filled.added} added)`;
}

/**
 * At start, prepareUserQueues() for every user (listUsers()), each logged.
 * A user whose profile or queue files are invalid is left alone, and
 * logged: their Run and Submit refuse until the file is fixed (fail
 * closed). Nothing here stops the server starting.
 *
 * @returns {void}
 */
function prepareQueues() {
  let questions, users;
  try {
    questions = questionInfos();
    users = listUsers();
  } catch (err) {
    console.error(`Queues: not prepared: ${/** @type {Error} */ (err).message}`);
    return;
  }
  for (const email of users) {
    try {
      console.log(`Queues: ${email}: ${prepareUserQueues(email, questions)}`);
    } catch (err) {
      console.error(`Queues: ${email}: left alone, ${/** @type {Error} */ (err).message}`);
    }
  }
}

/**
 * Moves a pair through the user's queue after a saved Submit
 * (recordSubmit() in order.js; step 6). A user without both files yet is
 * first given them as at start (detail 6). Only pairs canOpenPair()
 * accepts can come in from the backlog (detail 3).
 *
 * Synchronous on purpose: reading, changing and writing happen with no
 * await in between, so two Submits at once (two tabs) can't each read the
 * old queue and one overwrite the other's move (a lost update; D1).
 * backlog.json is written before order.json: a crash between the two then
 * leaves a pair in neither file, which the next start puts back in the
 * backlog, rather than in both, which would refuse the learner's Run and
 * Submit until the owner fixed it by hand.
 *
 * @param {string} email - The user's email.
 * @param {import('./order').BacklogElement} pair - The pair submitted.
 * @param {'yes' | 'no'} pass - From passFor().
 * @returns {void}
 * @throws {Error} If a question file, the profile or a queue file can't be
 *   read or is invalid, or a file can't be written.
 */
function updateQueue(email, pair, pass) {
  const questions = questionInfos();
  if (readUserFile(email, 'order.json') === undefined || readUserFile(email, 'backlog.json') === undefined) {
    console.log(`Queues: ${email}: ${prepareUserQueues(email, questions)}`);
  }
  const { order, backlog } = loadQueueFiles(email);
  const profile = loadProfile(email);
  const result = recordSubmit(order, backlog, pair, pass, { canIntroduce: canOpenPair(profile, questions) });
  if (JSON.stringify(result.backlog) !== JSON.stringify(backlog)) writeUserFile(email, 'backlog.json', result.backlog);
  writeUserFile(email, 'order.json', result.order);
}

/** How many errors and warnings the start log lists per user (step 10, detail 3). @type {number} */
const CONSISTENCY_LOG_LIMIT = 10;

/**
 * Logs the consistency check once, at start, after the queues are filled
 * (D5; step 10, detail 3): the totals, then a line per user with the counts, then its
 * errors and warnings, at most CONSISTENCY_LOG_LIMIT of them; info is only
 * counted. Never stops the server: the check only reports.
 *
 * @returns {Promise<void>} Never rejects: a failure is logged.
 */
async function logConsistency() {
  try {
    const sources = await readSources();
    const findings = checkConsistency(sources);
    const n = sources.users.length;
    console.log(`Consistency: ${n} ${n === 1 ? 'user' : 'users'} checked: ${describeCounts(countLevels(findings))}`);
    for (const f of findings.filter((x) => x.email === '')) console.log(`Consistency: ${formatFinding(f)}`);
    for (const { email } of sources.users) {
      const own = findings.filter((f) => f.email === email);
      console.log(`Consistency: ${email}: ${own.length ? describeCounts(countLevels(own)) : 'nothing found'}`);
      const listed = own.filter((f) => f.level !== 'info');
      for (const f of listed.slice(0, CONSISTENCY_LOG_LIMIT)) console.log(`  ${formatFinding(f)}`);
      if (listed.length > CONSISTENCY_LOG_LIMIT) console.log(`  …and ${listed.length - CONSISTENCY_LOG_LIMIT} more: run make consistency-check`);
    }
  } catch (err) {
    console.error(`Consistency: not checked: ${/** @type {Error} */ (err).message}`);
  }
}

/**
 * The start-up work, which server.js runs once before it listens: every
 * user's queue files (prepareQueues()), then the consistency check's log
 * (logConsistency(), which finishes after the server is listening).
 * Separate from loading this file, so requiring it does nothing by itself.
 * First, it refuses a test question bank with a users folder not marked
 * as test data (users.js, testBankRefusal; owner, 2026-11-09, option B2),
 * before prepareQueues() could add the test bank's questions to real
 * learners' backlogs.
 *
 * @returns {void}
 * @throws {Error} If testBankRefusal() refuses, so the server doesn't
 *   start; the message says why and what to change.
 */
function start() {
  const refused = testBankRefusal();
  if (refused) throw new Error(refused);
  prepareQueues();
  logConsistency();
}

// router and start are server.js's (contract 9); the public view and its
// lists, checkFillInTheBlankAnswer, judgeErrorAnswer and COULDNT_JUDGE are
// exported for routes.test.js only.
module.exports = { router, start, toPublicProblem, PUBLIC_COMMON_FIELDS, PUBLIC_CODE_FIELDS, PUBLIC_FILL_IN_THE_BLANK_FIELDS, checkFillInTheBlankAnswer, judgeErrorAnswer, COULDNT_JUDGE };

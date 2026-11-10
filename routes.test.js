'use strict';

// Tests for routes.js, the feature routes, through a real server: the
// characterization check made permanent (owner, 2026-11-06, option C).
// Run with `make test`.
//
// It starts `node server.js` from this checkout with throwaway users/ and
// auth/ folders on free ports, and sends it requests as a signed-out
// visitor, as learners signed in with invites, and as the owner on the
// trusted port. Each test names what it guards: the gate in front of the
// router (docs/contracts.md, contract 9), each route's answers and
// refusals, start()'s start-up work, no server path in an error (#85), and
// the queue-by-slug feature (owner, 2026-11-06).
//
// These are assertions, not a snapshot: a new question or a reworded
// message that isn't asserted here doesn't fail them. The snapshot that
// records everything, for a refactor like the server split, is
// scripts/characterize.js, run by hand.
//
// MAXRECALL_UNSANDBOXED=1 lets the server judge where the sandbox doesn't
// work, as in the cloud; it never turns a working one off
// (judge/sandbox.js), so elsewhere the code below is judged inside it.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync, execFileSync } = require('child_process');
const crypto = require('crypto');

const { toPublicProblem, PUBLIC_COMMON_FIELDS, PUBLIC_CODE_FIELDS, PUBLIC_FILL_IN_THE_BLANK_FIELDS, checkFillInTheBlankAnswer, judgeErrorAnswer, COULDNT_JUDGE } = require('./routes');
const { QUESTION_FIELDS, checkQuestion } = require('./question-files');

const REPO = __dirname;

const OWNER = 'owner@example.com'; // python on, javascript allowed but off, a chosen backlog (#133)
const LEARNER = 'learner.a@example.com'; // python and javascript, every question
const CHOOSER = 'chooser@example.com'; // python, a chosen backlog of hello-world alone
const BROKEN_PROFILE = 'broken.profile@example.com';
const BROKEN_QUEUE = 'broken.queue@example.com';
const NO_FOLDER = 'no.folder@example.com'; // users/<email> is a plain file
const PASSWORD = 'correct horse battery staple';

const TWO_SUM_PY = [
  'def two_sum(nums, target):',
  '    seen = {}',
  '    for i, n in enumerate(nums):',
  '        if target - n in seen:',
  '            return [seen[target - n], i]',
  '        seen[n] = i',
  '',
].join('\n');
const TWO_SUM_JS = [
  'function twoSum(nums, target) {',
  '  const seen = new Map();',
  '  for (let i = 0; i < nums.length; i++) {',
  '    if (seen.has(target - nums[i])) return [seen.get(target - nums[i]), i];',
  '    seen.set(nums[i], i);',
  '  }',
  '}',
  '',
].join('\n');
const WRONG_PY = 'def two_sum(nums, target):\n    return [0, 0]\n';

/**
 * The server process and what it has printed.
 *
 * @typedef {object} RunningServer
 * @property {import('child_process').ChildProcess} child - The process.
 * @property {string[]} log - Lines it has printed, stdout and stderr.
 * @property {number} port - PORT, where signing in is needed.
 * @property {number} trusted - TRUSTED_PORT, where every request is the owner.
 */

/**
 * One HTTP answer.
 *
 * @typedef {object} Answer
 * @property {number} status - The status code.
 * @property {http.IncomingHttpHeaders} headers - Its headers.
 * @property {Buffer} body - The body as sent.
 * @property {any} json - The body parsed, if it was JSON; otherwise undefined.
 */

/**
 * What a request sends besides its method and path.
 *
 * @typedef {object} SendOptions
 * @property {unknown} [json] - A body sent as JSON.
 * @property {string} [raw] - A body sent as text/plain, or as contentType.
 * @property {string} [contentType] - The raw body's Content-Type.
 * @property {string} [cookie] - The session cookie's value.
 */

/** @type {string} */
let tmp;
/** @type {RunningServer} */
let server;
/** @type {number} How many lines the start-up log had. */
let startupLines;
/** @type {Record<string, string>} Each learner's session cookie. */
const cookies = {};

/**
 * A free TCP port on 127.0.0.1, chosen by the system.
 *
 * @returns {Promise<number>} The port.
 */
async function freePort() {
  const probe = net.createServer();
  await new Promise(
    /**
     * Listens on port 0, so the system picks a free port.
     *
     * @param {(value?: unknown) => void} resolve - Settles once listening.
     * @returns {void}
     */
    (resolve) => {
      probe.listen(0, '127.0.0.1', resolve);
    },
  );
  const { port } = /** @type {net.AddressInfo} */ (probe.address());
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/**
 * Two different free ports.
 *
 * @returns {Promise<[number, number]>} PORT and TRUSTED_PORT.
 */
async function twoPorts() {
  const port = await freePort();
  let trusted = await freePort();
  while (trusted === port) trusted = await freePort();
  return [port, trusted];
}

/**
 * Starts `node server.js` from this checkout and waits until its start-up
 * work is over: both listeners up, then the consistency check's totals line
 * (logConsistency() runs after listening, since it awaits), then 300 ms
 * with no new output.
 *
 * @param {string} usersDir - MAXRECALL_USERS_DIR.
 * @param {string} authDir - MAXRECALL_AUTH_DIR.
 * @param {boolean} unsandboxed - Whether to set MAXRECALL_UNSANDBOXED=1.
 * @param {string} [questionsDir] - MAXRECALL_QUESTIONS_DIR, a folder of
 *   test questions; the repo's questions/ if left out. usersDir must then
 *   hold a TEST-USERS file, or the server refuses to start (users.js,
 *   testBankRefusal).
 * @returns {Promise<RunningServer>} The running server.
 * @throws {Error} If it exits first, or isn't done within 60 s.
 */
async function startServer(usersDir, authDir, unsandboxed, questionsDir) {
  const [port, trusted] = await twoPorts();
  /** @type {NodeJS.ProcessEnv} */
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8',
    PORT: String(port), TRUSTED_PORT: String(trusted),
    MAXRECALL_USER: OWNER, MAXRECALL_USERS_DIR: usersDir, MAXRECALL_AUTH_DIR: authDir,
  };
  if (unsandboxed) env.MAXRECALL_UNSANDBOXED = '1';
  if (questionsDir) env.MAXRECALL_QUESTIONS_DIR = questionsDir;
  const child = spawn(process.execPath, ['server.js'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
  /** @type {string[]} */
  const log = [];
  let pending = '';
  let exited = false;
  /**
   * Collects the server's output line by line.
   *
   * @param {Buffer} chunk - Output.
   * @returns {void}
   */
  const onData = (chunk) => {
    pending += chunk.toString();
    const parts = pending.split('\n');
    pending = parts.pop() || '';
    log.push(...parts);
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  child.on(
    'exit',
    /**
     * Notes that the server has exited, so waitFor() stops waiting.
     *
     * @returns {void}
     */
    () => {
      exited = true;
    },
  );
  /**
   * Waits until a line of the log matches, or fails, stopping the server
   * first: a server left running keeps the test process from exiting.
   *
   * @param {RegExp} pattern - What to wait for.
   * @param {number} ms - How long to wait.
   * @param {string} what - What's wrong if it doesn't come.
   * @returns {Promise<void>} Once a line matches.
   * @throws {Error} If the server exits, or no line matches in time.
   */
  const waitFor = async (pattern, ms, what) => {
    const started = Date.now();
    while (!log.some((l) => pattern.test(l))) {
      const problem = exited ? 'server.js exited at start' : Date.now() - started > ms ? what : null;
      if (problem) {
        if (!exited) child.kill('SIGKILL');
        throw new Error(`${problem}:\n${log.join('\n')}`);
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  await waitFor(/^Server listening/, 60000, 'server.js didn\'t listen within 60 s');
  await waitFor(/^Trusted listener/, 60000, 'no trusted listener within 60 s');
  // routes.js's start() runs logConsistency(); without it there's no such line.
  await waitFor(/^Consistency: (\d+ users? checked|not checked)/, 10000, 'no Consistency line within 10 s of listening: does server.js call start()?');
  let count = -1;
  while (count !== log.length) {
    count = log.length;
    await new Promise((r) => setTimeout(r, 300));
  }
  return { child, log, port, trusted };
}

/**
 * Stops a server and waits for it to exit.
 *
 * @param {RunningServer | undefined} running - The server, if it started.
 * @returns {Promise<void>} Once it has exited.
 */
async function stopServer(running) {
  if (!running || running.child.exitCode !== null) return;
  const exited = new Promise((resolve) => running.child.once('exit', resolve));
  running.child.kill('SIGTERM');
  await exited;
}

/**
 * Sends one request to 127.0.0.1, the path exactly as given: no URL
 * normalizing, which fetch() would do to a path like /%2e%2e/server.js.
 *
 * @param {number} port - The port.
 * @param {string} method - The HTTP method.
 * @param {string} urlPath - The path, sent as is.
 * @param {SendOptions} [options] - The body and cookie, if any.
 * @returns {Promise<Answer>} The answer.
 */
function send(port, method, urlPath, options = {}) {
  /** @type {http.OutgoingHttpHeaders} */
  const headers = { connection: 'close' };
  /** @type {string | undefined} */
  let body;
  if (options.json !== undefined) {
    body = JSON.stringify(options.json);
    headers['content-type'] = 'application/json';
  } else if (options.raw !== undefined) {
    body = options.raw;
    headers['content-type'] = options.contentType || 'text/plain';
  }
  if (body !== undefined) headers['content-length'] = Buffer.byteLength(body);
  if (options.cookie) headers.cookie = `maxrecall_session=${options.cookie}`;
  return new Promise(
    /**
     * Sends the request and collects the answer.
     *
     * @param {(answer: Answer) => void} resolve - Settles with the answer.
     * @param {(err: Error) => void} reject - Fails on a connection error.
     * @returns {void}
     */
    (resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, method, path: urlPath, headers },
        /**
         * Collects the body, then settles with the answer.
         *
         * @param {http.IncomingMessage} res - The response.
         * @returns {void}
         */
        (res) => {
          /** @type {Buffer[]} */
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on(
            'end',
            /**
             * Parses a JSON body and settles.
             *
             * @returns {void}
             */
            () => {
              const raw = Buffer.concat(chunks);
              let json;
              if (String(res.headers['content-type'] || '').includes('json')) {
                try { json = JSON.parse(raw.toString()); } catch { json = undefined; }
              }
              resolve({ status: res.statusCode || 0, headers: res.headers, body: raw, json });
            },
          );
        },
      );
      req.on('error', reject);
      if (body !== undefined) req.write(body);
      req.end();
    },
  );
}

/**
 * Sends a request as a signed-in learner on PORT.
 *
 * @param {string} email - The learner (signed in by before()).
 * @param {string} method - The HTTP method.
 * @param {string} urlPath - The path.
 * @param {unknown} [json] - A body sent as JSON, if any.
 * @returns {Promise<Answer>} The answer.
 */
function as(email, method, urlPath, json) {
  return send(server.port, method, urlPath, { cookie: cookies[email], json });
}

/**
 * Sends a request as the owner, on the trusted port (no sign-in).
 *
 * @param {string} method - The HTTP method.
 * @param {string} urlPath - The path.
 * @param {unknown} [json] - A body sent as JSON, if any.
 * @returns {Promise<Answer>} The answer.
 */
function asOwner(method, urlPath, json) {
  return send(server.trusted, method, urlPath, { json });
}

/**
 * Writes a file, making its folder: JSON for an object, or a string as is.
 *
 * @param {string} file - The file.
 * @param {unknown} value - Its content.
 * @returns {void}
 */
function writeFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Reads a learner's JSON file from the test's users folder.
 *
 * @param {string} email - The learner.
 * @param {string} name - The file's name, e.g. "order.json".
 * @returns {any} Its content, parsed.
 */
function readUserJson(email, name) {
  return JSON.parse(fs.readFileSync(path.join(tmp, 'users', email, name), 'utf8'));
}

/**
 * The pairs in a queue or backlog file, as "question/language".
 *
 * @param {{ question: string, language: string }[]} pairs - The file's queue or backlog.
 * @returns {string[]} One string per pair, in order.
 */
function pairNames(pairs) {
  return pairs.map((p) => `${p.question}/${p.language}`);
}

/**
 * Makes invite codes with auth.js's createInvite, in a child process so
 * auth.js reads MAXRECALL_AUTH_DIR as the server does.
 *
 * @param {string} authDir - The sign-in folder.
 * @param {string[]} emails - Who to invite.
 * @returns {Record<string, string>} Each email's code.
 */
function makeInvites(authDir, emails) {
  const script = `(async () => { const { createInvite } = require('./auth'); const out = {}; for (const e of ${JSON.stringify(emails)}) out[e] = (await createInvite(e)).code; console.log(JSON.stringify(out)); })();`;
  const out = execFileSync(process.execPath, ['-e', script], { cwd: REPO, env: { ...process.env, MAXRECALL_AUTH_DIR: authDir } });
  return JSON.parse(out.toString());
}

/**
 * The session cookie's value an answer sets.
 *
 * @param {Answer} answer - The answer.
 * @returns {string} The cookie's value.
 * @throws {Error} If the answer sets none.
 */
function sessionCookieOf(answer) {
  for (const c of answer.headers['set-cookie'] || []) {
    const m = /^maxrecall_session=([^;]+)/.exec(c);
    if (m) return m[1];
  }
  throw new Error(`no session cookie: ${answer.status} ${answer.body}`);
}

before(
  /**
   * Sets up the learners' files, starts the server, and registers each
   * learner with an invite.
   *
   * @returns {Promise<void>} Once every learner is signed in.
   */
  async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maxrecall-routes-test-'));
    const usersDir = path.join(tmp, 'users');
    const authDir = path.join(tmp, 'auth');
    // A learner with two languages and one pair in the queue; start() fills
    // their backlog (backlog "all", the default).
    writeFile(path.join(usersDir, LEARNER, 'profile.json'), { schemaVersion: 1, allowed: { languages: ['python', 'javascript'] } });
    writeFile(path.join(usersDir, LEARNER, 'order.json'), { schemaVersion: 1, submitsSinceLastIntroduced: 0, queue: [{ question: 'two-sum', language: 'python', passesInARow: 0 }] });
    // A learner set up as make learner-create does: a chosen backlog.
    writeFile(path.join(usersDir, CHOOSER, 'profile.json'), { schemaVersion: 1, allowed: { languages: ['python'] }, backlog: 'chosen' });
    writeFile(path.join(usersDir, CHOOSER, 'order.json'), { schemaVersion: 1, submitsSinceLastIntroduced: 0, queue: [] });
    writeFile(path.join(usersDir, CHOOSER, 'backlog.json'), { schemaVersion: 1, backlog: [{ question: 'hello-world', language: 'python' }] });
    // The owner, for the question bank (#133): JavaScript allowed but turned
    // off, with a pair of it in the queue, which the list doesn't show and
    // the bank does; a chosen backlog, so nothing is added at start.
    writeFile(path.join(usersDir, OWNER, 'profile.json'), { schemaVersion: 1, allowed: { languages: ['python', 'javascript'] }, preferred: { languages: ['python'], defaultLanguage: 'python' }, backlog: 'chosen' });
    writeFile(path.join(usersDir, OWNER, 'order.json'), {
      schemaVersion: 1, submitsSinceLastIntroduced: 0,
      queue: [{ question: 'hello-world', language: 'javascript', passesInARow: 0 }, { question: 'valid-parentheses', language: 'python', passesInARow: 0 }],
    });
    writeFile(path.join(usersDir, OWNER, 'backlog.json'), { schemaVersion: 1, backlog: [{ question: 'two-sum', language: 'python' }] });
    writeFile(path.join(usersDir, BROKEN_PROFILE, 'profile.json'), { schemaVersion: 1, colour: 'blue' });
    writeFile(path.join(usersDir, BROKEN_QUEUE, 'profile.json'), { schemaVersion: 1, allowed: { languages: ['python'] } });
    writeFile(path.join(usersDir, BROKEN_QUEUE, 'order.json'), '{ not json\n');
    writeFile(path.join(usersDir, NO_FOLDER), 'a plain file where the folder should be\n');
    fs.mkdirSync(authDir, { recursive: true, mode: 0o700 });
    const learners = [LEARNER, CHOOSER, BROKEN_PROFILE, BROKEN_QUEUE, NO_FOLDER];
    const invites = makeInvites(authDir, learners);

    server = await startServer(usersDir, authDir, true);
    startupLines = server.log.length;
    for (const email of learners) {
      const answer = await send(server.port, 'POST', '/api/auth/register', { json: { email, invite: invites[email], password: PASSWORD } });
      assert.equal(answer.status, 200, `registering ${email}: ${answer.body}`);
      cookies[email] = sessionCookieOf(answer);
    }
  },
);

after(
  /**
   * Stops the server and removes the throwaway folders.
   *
   * @returns {Promise<void>} Once done.
   */
  async () => {
    await stopServer(server);
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  },
);

// ---- start() (contract 9: server.js calls it once, before listening) ----

test('start(): prepareQueues() fills a learner\'s backlog before any request', () => {
  const backlog = pairNames(readUserJson(LEARNER, 'backlog.json').backlog);
  assert.ok(backlog.includes('hello-world/python'), 'every question, in each allowed language');
  assert.ok(backlog.includes('hello-world/javascript'));
  assert.ok(!backlog.includes('two-sum/python'), 'not a pair already in the queue');
  assert.ok(!backlog.some((p) => p.endsWith('/java')), 'not a language the profile doesn\'t allow');
});

test('start(): a chosen backlog gets nothing added', () => {
  assert.deepEqual(pairNames(readUserJson(CHOOSER, 'backlog.json').backlog), ['hello-world/python']);
});

test('start(): logConsistency() reports, and names the learner with an invalid queue', () => {
  const startup = server.log.slice(0, startupLines);
  assert.ok(startup.some((l) => /^Consistency: \d+ users checked: [1-9]\d* errors?/.test(l)), startup.join('\n'));
  assert.ok(startup.some((l) => l.startsWith(`Consistency: ${BROKEN_QUEUE}: 1 error`)), startup.join('\n'));
});

// ---- The gate in front of the router (contract 9) ----

test('start-up: a test question bank with an unmarked users folder stops the server before it listens (owner, 2026-11-09, B2)', async () => {
  const [port, trusted] = await twoPorts();
  const usersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maxrecall-routes-test-bank-'));
  try {
    const run = spawnSync(process.execPath, ['server.js'], {
      cwd: REPO,
      // MAXRECALL_USERS_DIR set, as the live service sets it, but no TEST-USERS file.
      env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), TRUSTED_PORT: String(trusted), MAXRECALL_USER: OWNER, MAXRECALL_USERS_DIR: usersDir, MAXRECALL_AUTH_DIR: usersDir, MAXRECALL_QUESTIONS_DIR: path.join(REPO, 'questions') },
      encoding: 'utf8',
      timeout: 30000, // a server that starts never exits: then status is null and this fails
    });
    assert.notEqual(run.status, 0, `exited with ${run.status} (signal ${run.signal})`);
    assert.notEqual(run.status, null, 'it started instead of refusing');
    assert.match(run.stderr, /MAXRECALL_QUESTIONS_DIR is set .*has no TEST-USERS file/);
    assert.doesNotMatch(run.stdout, /Server listening/);
  } finally {
    fs.rmSync(usersDir, { recursive: true, force: true });
  }
});

test('the gate: signed out, every feature route is 401 and gives nothing away', async () => {
  /** @type {[string, string, unknown?][]} */
  const routes = [
    ['GET', '/api/questions'], ['GET', '/api/questions/two-sum'], ['GET', '/api/profile'],
    ['GET', '/api/next'], ['GET', '/api/queue'], ['GET', '/api/question-bank'], ['GET', '/api/submissions'],
    ['GET', '/api/submissions/2026-01-01T00-00-00.000Z'], ['GET', '/api/nope'],
    ['POST', '/api/questions/two-sum/run', { language: 'python', code: TWO_SUM_PY }],
    ['POST', '/api/questions/two-sum/submit', { language: 'python', code: TWO_SUM_PY }],
    ['POST', '/api/questions/two-sum/skip', { language: 'python', code: '' }],
    ['POST', '/api/questions/two-sum/test', { language: 'python', code: TWO_SUM_PY }],
    ['PATCH', '/api/profile/preferred', { languages: ['python'] }],
  ];
  for (const [method, urlPath, json] of routes) {
    const answer = await send(server.port, method, urlPath, { json });
    assert.equal(answer.status, 401, `${method} ${urlPath}`);
    assert.deepEqual(answer.json, { error: 'Not signed in' }, `${method} ${urlPath}`);
  }
});

test('the gate: signed out, a page sends you to the login page and back', async () => {
  const answer = await send(server.port, 'GET', '/problem.html?slug=two-sum&language=python');
  assert.equal(answer.status, 302);
  assert.equal(answer.headers.location, '/login.html?next=%2Fproblem.html%3Fslug%3Dtwo-sum%26language%3Dpython');
  assert.equal((await send(server.port, 'GET', '/login.html')).status, 200, 'the login page is public');
});

test('the gate: a POST or PATCH that isn\'t JSON is 415, before signing in is checked', async () => {
  const run = await send(server.port, 'POST', '/api/questions/two-sum/run', { raw: 'language=python', contentType: 'application/x-www-form-urlencoded' });
  assert.equal(run.status, 415);
  assert.equal((await send(server.port, 'PATCH', '/api/profile/preferred', { raw: '{}' })).status, 415);
  const signedIn = await send(server.port, 'PATCH', '/api/profile/preferred', { raw: '{}', cookie: cookies[LEARNER] });
  assert.equal(signedIn.status, 415, 'signed in too');
});

test('the gate: the trusted port is the owner, with no sign-in', async () => {
  assert.deepEqual((await asOwner('GET', '/api/auth/me')).json, { email: OWNER, trusted: true });
  assert.equal((await as(LEARNER, 'GET', '/api/auth/me')).json.trusted, false);
});

test('an /api/ URL no route claims is a JSON 404, not a page', async () => {
  for (const [method, urlPath] of [['GET', '/api/nope'], ['DELETE', '/api/questions/two-sum'], ['GET', '/api/']]) {
    const answer = await as(LEARNER, method, urlPath);
    assert.equal(answer.status, 404, `${method} ${urlPath}`);
    assert.match(answer.json.error, /^No such API endpoint/);
  }
});

test('only the files meant to be served are: anything else gets index.html, never the file itself', async () => {
  const index = fs.readFileSync(path.join(REPO, 'index.html'));
  for (const file of ['problem.html', 'problem-page.js', 'problems-list.js', 'timer.js', 'style.css']) {
    const answer = await as(LEARNER, 'GET', `/${file}`);
    assert.equal(answer.status, 200, file);
    assert.ok(answer.body.equals(fs.readFileSync(path.join(REPO, file))), `${file} is served as it is`);
  }
  const probes = [
    '/server.js', '/routes.js', '/package.json', '/.env', '/users/', `/users/${LEARNER}/profile.json`,
    '/auth/', '/questions/two-sum.json', '/judge/runner.js', '/%2e%2e/server.js', '/..%2Fserver.js',
    '/readme.html', '/docs/contracts.md',
  ];
  for (const probe of probes) {
    const answer = await as(LEARNER, 'GET', probe);
    assert.equal(answer.status, 200, probe);
    assert.ok(answer.body.equals(index), `${probe} gets index.html`);
  }
});

// ---- Questions ----

test('questions: the list, and one question without its hidden test cases', async () => {
  const list = await as(LEARNER, 'GET', '/api/questions');
  assert.equal(list.status, 200);
  const slugs = list.json.map((/** @type {{ slug: string }} */ q) => q.slug);
  assert.ok(slugs.includes('two-sum') && slugs.includes('hello-world'), slugs.join(' '));

  const file = JSON.parse(fs.readFileSync(path.join(REPO, 'questions', 'two-sum.json'), 'utf8'));
  const hidden = file.testCases.filter((/** @type {{ hidden?: boolean }} */ tc) => tc.hidden);
  assert.ok(hidden.length > 0, 'two-sum has hidden cases to hide');
  const one = await as(LEARNER, 'GET', '/api/questions/two-sum');
  assert.equal(one.status, 200);
  assert.equal(one.json.testCases, undefined, 'no testCases');
  assert.equal(one.json.hiddenCount, hidden.length);
  assert.equal(one.json.visibleTestCases.length, file.testCases.length - hidden.length);
});

test('questions: the public view sends only allowed fields, in the file\'s order (#160, Q4)', () => {
  const question = /** @type {import('./routes').Problem & { secret: string }} */ ({
    title: 'T', secret: 'not for the browser', slug: 's', difficulty: 'Easy', topics: [], sources: [], created: '2026-11-08T00:00:00Z',
    starterCode: { python: '' },
    testCases: [{ args: [1], expected: 1 }, { args: [2], expected: 2, hidden: true }],
  });
  const sent = toPublicProblem(question);
  // created is in the file but not on the list (owner, 2026-11-08). kind is
  // added, "code" for a file without one (kindOf).
  assert.deepEqual(Object.keys(sent), ['title', 'slug', 'difficulty', 'topics', 'sources', 'starterCode', 'kind', 'visibleTestCases', 'hiddenCount']);
  assert.equal(sent.kind, 'code');
  assert.deepEqual(sent.visibleTestCases, [{ args: [1], expected: 1 }]);
  assert.equal(sent.hiddenCount, 1);
});

// The tests below cast this through unknown to Problem, whose starterCode
// and testCases a code question has and this one doesn't: Problem only
// describes the code paths so far, and toPublicProblem doesn't read them
// for this kind.
/** A fill-in-the-blank question file's contents, as the format allows, plus a field no list names. */
const FILL_IN_THE_BLANK = Object.freeze({
  slug: 'f', title: 'F', difficulty: 'Fundamentals', topics: [], sources: [], created: '2026-11-09T00:00:00Z',
  kind: 'fill-in-the-blank', description: { python: '<p>Fill it in.</p>' },
  template: { python: 'print("It___s")' }, blank: '___', secret: 'not for the browser',
});

test('questions: a fill-in-the-blank question\'s public view: its template and blank, maxLength with its default (#160)', () => {
  const sent = toPublicProblem(/** @type {import('./routes').Problem} */ (/** @type {unknown} */ (FILL_IN_THE_BLANK)));
  assert.deepEqual(Object.keys(sent), ['slug', 'title', 'difficulty', 'topics', 'sources', 'description', 'template', 'blank', 'kind', 'maxLength']);
  assert.equal(sent.kind, 'fill-in-the-blank');
  assert.equal(sent.maxLength, 10, 'the default, from fillInTheBlankMaxLength');
  const given = toPublicProblem(/** @type {import('./routes').Problem} */ (/** @type {unknown} */ ({ ...FILL_IN_THE_BLANK, maxLength: 3 })));
  assert.equal(given.maxLength, 3);
});

test('questions: a kind the server doesn\'t know sends only the common fields and its kind', () => {
  const sent = toPublicProblem(/** @type {import('./routes').Problem} */ (/** @type {unknown} */ ({ ...FILL_IN_THE_BLANK, kind: 'quiz', starterCode: { python: '' } })));
  assert.deepEqual(Object.keys(sent), ['slug', 'title', 'difficulty', 'topics', 'sources', 'description', 'kind']);
  assert.equal(sent.kind, 'quiz');
});

test('questions: every allowed field is one of the format\'s, and testCases isn\'t allowed', () => {
  for (const list of [PUBLIC_COMMON_FIELDS, PUBLIC_CODE_FIELDS, PUBLIC_FILL_IN_THE_BLANK_FIELDS]) {
    for (const field of list) assert.ok(QUESTION_FIELDS.includes(field), `${field} isn't in QUESTION_FIELDS`);
    assert.ok(!list.includes('testCases'));
  }
  for (const field of PUBLIC_COMMON_FIELDS) {
    assert.ok(PUBLIC_CODE_FIELDS.includes(field) && PUBLIC_FILL_IN_THE_BLANK_FIELDS.includes(field), `${field} is common but not in every kind's list`);
  }
});

test('fill-in-the-blank answers: what the route lets through to the judge (contract 2; #160 Q12)', () => {
  const question = /** @type {import('./routes').Problem} */ (/** @type {unknown} */ (FILL_IN_THE_BLANK)); // maxLength 10 by default
  const three = /** @type {import('./routes').Problem} */ (/** @type {unknown} */ ({ ...FILL_IN_THE_BLANK, maxLength: 3 }));
  /** @type {[string, unknown, import('./routes').Problem, RegExp | null][]} */
  const cases = [
    ['a valid blank', { blank: "'" }, question, null],
    ['an empty blank (the judge says whether it\'s wrong)', { blank: '' }, question, null],
    ['exactly maxLength', { blank: 'x'.repeat(10) }, question, null],
    ['a given maxLength', { blank: 'abc' }, three, null],
    ['not sent', undefined, question, /answer must be an object/],
    ['null', null, question, /answer must be an object/],
    ['a string', "'", question, /answer must be an object/],
    ['an array', ["'"], question, /answer must be an object/],
    ['no fields', {}, question, /one field, blank, and no other/],
    ['another field too', { blank: "'", code: 'x' }, question, /one field, blank, and no other/],
    ['__proto__ as a field (JSON.parse makes it an own key)', JSON.parse('{"blank":"x","__proto__":{}}'), question, /one field, blank, and no other/],
    ['blank a number', { blank: 1 }, question, /blank must be a string/],
    ['blank an array, which has a length', { blank: ["'"] }, question, /blank must be a string/],
    ['blank { length: 1 }', { blank: { length: 1 } }, question, /blank must be a string/],
    ['over the default maxLength', { blank: 'x'.repeat(11) }, question, /at most 10 characters/],
    ['over a given maxLength', { blank: 'abcd' }, three, /at most 3 characters/],
    // .length counts UTF-16 code units, as HTML's maxlength does: an emoji is two.
    ['five emoji are ten units', { blank: '😀'.repeat(5) }, question, null],
    ['six emoji are twelve units', { blank: '😀'.repeat(6) }, question, /at most 10 characters/],
  ];
  for (const [name, answer, q, expected] of cases) {
    const why = checkFillInTheBlankAnswer(answer, q);
    if (expected === null) assert.equal(why, null, name);
    else assert.match(String(why), expected, name);
  }
});

test('a failed judging: 503 for an unavailable or busy judge, 500 "couldn\'t judge" for JUDGE_FAILED, 500 otherwise', () => {
  /**
   * An error as judging throws it.
   *
   * @param {string | undefined} code - Its code.
   * @param {object} [more] - Other fields.
   * @returns {import('./routes').JudgeError} The error.
   */
  const thrown = (code, more = {}) => Object.assign(new Error(`message for ${code}`), { code }, more);
  assert.deepEqual(judgeErrorAnswer(thrown('SANDBOX_UNAVAILABLE')), { status: 503, error: 'message for SANDBOX_UNAVAILABLE' });
  assert.deepEqual(judgeErrorAnswer(thrown('JUDGE_BUSY', { retryAfterSeconds: 7 })), { status: 503, error: 'message for JUDGE_BUSY', retryAfterSeconds: 7 });
  // The owner's choice, 2026-11-09; the judge's own message never reaches the page.
  assert.deepEqual(judgeErrorAnswer(thrown('JUDGE_FAILED')), { status: 500, error: COULDNT_JUDGE });
  assert.equal(COULDNT_JUDGE, "We couldn't judge this answer; it wasn't recorded.");
  for (const code of [undefined, 'ENOENT']) {
    const answer = judgeErrorAnswer(thrown(code));
    assert.equal(answer.status, 500);
    assert.match(answer.error, /^Execution failed: /);
    assert.doesNotMatch(answer.error, /message for/, 'the error\'s own message isn\'t sent');
  }
});

test('questions: an unknown slug, or one that tries to leave questions/, is 404', async () => {
  for (const slug of ['nope', '..%2Fpackage']) {
    const answer = await as(LEARNER, 'GET', `/api/questions/${slug}`);
    assert.equal(answer.status, 404, slug);
    assert.deepEqual(answer.json, { error: 'Question not found' });
  }
});

// ---- Run, Test, Submit, Skip ----

test('Run: 404, 400 and 403 refusals, then a judged run', async () => {
  const run = '/api/questions/two-sum/run';
  assert.equal((await as(LEARNER, 'POST', '/api/questions/nope/run', { language: 'python', code: TWO_SUM_PY })).status, 404);
  assert.equal((await as(LEARNER, 'POST', run, { language: 'klingon', code: TWO_SUM_PY })).status, 400);
  assert.equal((await as(LEARNER, 'POST', run, { language: 'python', code: '   ' })).status, 400, 'blank code');
  const java = await as(LEARNER, 'POST', run, { language: 'java', code: 'class X {}' });
  assert.equal(java.status, 403, 'a language the profile doesn\'t allow');
  assert.match(java.json.error, /java isn't one of the languages you can use/);

  const accepted = await as(LEARNER, 'POST', run, { language: 'python', code: TWO_SUM_PY });
  assert.equal(accepted.status, 200, accepted.body.toString());
  assert.equal(accepted.json.status, 'Accepted');
  assert.equal(accepted.json.saved, undefined, 'a Run isn\'t recorded');
  const js = await as(LEARNER, 'POST', run, { language: 'javascript', code: TWO_SUM_JS });
  assert.equal(js.json.status, 'Accepted', js.body.toString());
  const wrong = await as(LEARNER, 'POST', run, { language: 'python', code: WRONG_PY });
  assert.equal(wrong.json.status, 'Wrong Answer');
});

test('Test: only the owner may; it judges every case and records nothing (contract 3)', async () => {
  const test_ = '/api/questions/two-sum/test';
  const refused = await as(LEARNER, 'POST', test_, { language: 'python', code: TWO_SUM_PY });
  assert.equal(refused.status, 403);
  assert.deepEqual(refused.json, { error: 'Only the owner can Test questions.' });

  const tested = await asOwner('POST', test_, { language: 'python', code: TWO_SUM_PY });
  assert.equal(tested.status, 200, tested.body.toString());
  assert.equal(tested.json.tested, true);
  assert.equal(tested.json.total, tested.json.results.length, 'hidden cases included');
  assert.equal((await asOwner('GET', '/api/submissions')).json.length, 0, 'nothing recorded');
});

test('Submit: a bad elapsedMs is 400; a wrong Submit is saved as a fail; an Accepted one is saved and moves the queue', async () => {
  const submit = '/api/questions/two-sum/submit';
  /**
   * The learner's two-sum pair in Python, from their order.json.
   *
   * @returns {{ pass?: string, passesInARow?: number }} The pair's element.
   */
  const pairNow = () => {
    return readUserJson(LEARNER, 'order.json').queue.find((/** @type {{ question: string, language: string }} */ p) => p.question === 'two-sum' && p.language === 'python');
  };
  for (const elapsedMs of [-1, 1.5]) {
    const answer = await as(LEARNER, 'POST', submit, { language: 'python', code: TWO_SUM_PY, elapsedMs });
    assert.equal(answer.status, 400, `elapsedMs ${elapsedMs}`);
  }
  // A wrong answer is saved and counted as a fail, and says so (pass), so
  // the page keeps Submit for another try (D7, as changed 2026-11-07).
  const wrong = await as(LEARNER, 'POST', submit, { language: 'python', code: WRONG_PY });
  assert.equal(wrong.status, 200, wrong.body.toString());
  assert.equal(wrong.json.status, 'Wrong Answer');
  assert.equal(wrong.json.pass, 'no');
  assert.equal(wrong.json.saved, true);
  assert.equal(wrong.json.queueUpdated, true);
  assert.equal(pairNow().pass, 'no');
  assert.equal(pairNow().passesInARow, 0);

  const answer = await as(LEARNER, 'POST', submit, { language: 'python', code: TWO_SUM_PY, elapsedMs: 1234 });
  assert.equal(answer.status, 200, answer.body.toString());
  assert.equal(answer.json.status, 'Accepted');
  assert.equal(answer.json.pass, 'yes');
  assert.equal(answer.json.saved, true);
  assert.equal(answer.json.queueUpdated, true);

  const record = await as(LEARNER, 'GET', `/api/submissions/${answer.json.submissionId}`);
  assert.equal(record.status, 200);
  assert.equal(record.json.code, TWO_SUM_PY);
  assert.equal(record.json.elapsedMs, 1234);
  // Records version 4: a code record is version 3 with schemaVersion 4 and
  // kind "code", and nothing else changed (docs/plans/submission-records-v4.md).
  assert.equal(record.json.schemaVersion, 4);
  assert.equal(record.json.kind, 'code');
  assert.deepEqual(Object.keys(record.json), ['id', 'schemaVersion', 'submittedAt', 'question', 'questionSha256', 'language', 'kind', 'judgeMode', 'code', 'status', 'passed', 'total', 'runtimeMs', 'elapsedMs', 'results', 'stdout', 'stderr']);
  assert.equal(pairNow().pass, 'yes');
  assert.equal(pairNow().passesInARow, 1);
});

test('Skip: a streak is lost only once confirmed (409 CONFIRM_STREAK first)', async () => {
  const skip = '/api/questions/two-sum/skip';
  assert.equal((await as(LEARNER, 'POST', skip, { language: 'python', code: '', confirmed: 'yes' })).status, 400);
  const asked = await as(LEARNER, 'POST', skip, { language: 'python', code: '' });
  assert.equal(asked.status, 409);
  assert.equal(asked.json.code, 'CONFIRM_STREAK');
  assert.equal(asked.json.passesInARow, 1);

  const skipped = await as(LEARNER, 'POST', skip, { language: 'python', code: 'x = 1', confirmed: true });
  assert.equal(skipped.status, 200, skipped.body.toString());
  assert.ok(skipped.json.next, 'it answers with what\'s next');
  const pair = readUserJson(LEARNER, 'order.json').queue.find((/** @type {{ question: string, language: string }} */ p) => p.question === 'two-sum' && p.language === 'python');
  assert.equal(pair.pass, 'no');
  assert.equal(pair.passesInARow, 0);
});

// ---- Submissions, profile, next and queue ----

test('submissions: filtered by question and language, and refusals', async () => {
  const all = await as(LEARNER, 'GET', '/api/submissions?question=two-sum&language=python');
  assert.equal(all.status, 200);
  assert.equal(all.json.length, 3, 'the two Submits and the Skip');
  assert.ok(all.json.every((/** @type {{ kind: string, message?: string }} */ s) => s.kind === 'code' && !('message' in s) && !('answer' in s)), 'each summary says its kind (records v4); no answer for code');
  assert.equal((await as(LEARNER, 'GET', '/api/submissions?question=hello-world')).json.length, 0);
  assert.equal((await as(LEARNER, 'GET', '/api/submissions?language=klingon')).status, 400);
  assert.equal((await as(LEARNER, 'GET', '/api/submissions?question=a&question=b')).status, 400);
  for (const id of ['2026-01-01T00-00-00.000Z', '..%2F..%2Fprofile']) {
    assert.equal((await as(LEARNER, 'GET', `/api/submissions/${id}`)).status, 404, id);
  }
});

test('profile: the preferred languages change within what\'s allowed, and nothing else does', async () => {
  const changed = await as(LEARNER, 'PATCH', '/api/profile/preferred', { languages: ['python'], defaultLanguage: 'python' });
  assert.equal(changed.status, 200, changed.body.toString());
  assert.deepEqual(readUserJson(LEARNER, 'profile.json').preferred, { languages: ['python'], defaultLanguage: 'python' });
  assert.equal((await as(LEARNER, 'PATCH', '/api/profile/preferred', { languages: ['cpp'] })).status, 400, 'not an allowed language');
  assert.equal((await as(LEARNER, 'PATCH', '/api/profile/preferred', { colour: 'blue' })).status, 400, 'not a field that can change');
  const profile = await as(LEARNER, 'GET', '/api/profile');
  assert.deepEqual([...profile.json.allowedLanguages].sort(), ['javascript', 'python'], 'allowed is unchanged');
});

test('next and queue: what to do next, and the list of pairs', async () => {
  const next = await as(LEARNER, 'GET', '/api/next');
  assert.equal(next.status, 200);
  assert.equal(typeof next.json.next.question, 'string');
  const queue = await as(LEARNER, 'GET', '/api/queue');
  assert.equal(queue.status, 200);
  assert.ok(queue.json.pairs.some((/** @type {{ question: string, where: string }} */ p) => p.question === 'two-sum' && p.where === 'queue'));
});

test('question bank (#133): the owner sees every question and where each pair is; anyone else is refused', async () => {
  const bank = await asOwner('GET', '/api/question-bank');
  assert.equal(bank.status, 200, bank.body.toString());
  assert.deepEqual(bank.json.languages, ['python', 'javascript'], 'the allowed languages, those turned on first');

  /** @type {{ slug: string, created: string, pairs: Record<string, unknown> }[]} */
  const questions = bank.json.questions;
  const everySlug = (await asOwner('GET', '/api/questions')).json.map((/** @type {{ slug: string }} */ q) => q.slug).sort();
  assert.deepEqual(questions.map((q) => q.slug).sort(), everySlug, 'every question in questions/');
  const order = questions.map((q) => `${q.created} ${q.slug}`);
  assert.deepEqual(order, [...order].sort(), 'by created, then slug');

  /**
   * One question's pairs, from the bank.
   *
   * @param {string} slug - The question.
   * @returns {Record<string, unknown>} Its pairs, by language.
   */
  const pairsOf = (slug) => {
    const found = questions.find((q) => q.slug === slug);
    assert.ok(found, slug);
    return found.pairs;
  };
  assert.deepEqual(pairsOf('valid-parentheses'), { python: { where: 'queue', position: 1, listed: true } }, 'first on the list: the pair before it is off');
  assert.deepEqual(pairsOf('hello-world'), { javascript: { where: 'queue', listed: false } }, 'off, so not listed, but shown; python in neither file');
  assert.deepEqual(pairsOf('two-sum'), { python: { where: 'backlog', listed: true } });

  const owner = await asOwner('GET', '/api/profile');
  assert.equal(owner.json.canSeeQuestionBank, true);
  const learner = await as(LEARNER, 'GET', '/api/profile');
  assert.equal(learner.json.canSeeQuestionBank, false);
  const refused = await as(LEARNER, 'GET', '/api/question-bank');
  assert.equal(refused.status, 403);
  assert.equal(refused.json.questions, undefined, 'nothing of the bank');
});

// ---- A feature, not a gap (owner, 2026-11-06) ----

test('a feature: a question not in a chosen backlog, opened by its slug, joins the queue at its Submit or Skip', async () => {
  // docs/how-to-put-a-question-directly-into-my-queue-by-slug.html. A chosen
  // backlog limits what the list and Next offer, not what can be opened:
  // routes.js (checkExecutionRequest) must not refuse it. order.test.js
  // checks order.js's side of it.
  assert.equal((await as(CHOOSER, 'GET', '/api/questions/two-sum')).status, 200, 'it opens');
  const submitted = await as(CHOOSER, 'POST', '/api/questions/two-sum/submit', { language: 'python', code: TWO_SUM_PY });
  assert.equal(submitted.status, 200, submitted.body.toString());
  assert.equal(submitted.json.saved, true);
  assert.equal(submitted.json.queueUpdated, true);
  assert.ok(pairNames(readUserJson(CHOOSER, 'order.json').queue).includes('two-sum/python'), 'Submit: in the queue');

  const skipped = await as(CHOOSER, 'POST', '/api/questions/valid-parentheses/skip', { language: 'python', code: '' });
  assert.equal(skipped.status, 200, skipped.body.toString());
  assert.ok(pairNames(readUserJson(CHOOSER, 'order.json').queue).includes('valid-parentheses/python'), 'Skip: in the queue');
});

// ---- A learner's files, when they're wrong (fail closed) ----

test('an invalid profile.json is 500 INVALID_PROFILE wherever it\'s read', async () => {
  /** @type {[string, string, unknown?][]} */
  const routes = [
    ['GET', '/api/profile'], ['GET', '/api/next'], ['GET', '/api/queue'],
    ['POST', '/api/questions/two-sum/run', { language: 'python', code: TWO_SUM_PY }],
    ['POST', '/api/questions/two-sum/skip', { language: 'python', code: '' }],
    ['PATCH', '/api/profile/preferred', { languages: ['python'] }],
  ];
  for (const [method, urlPath, json] of routes) {
    const answer = await as(BROKEN_PROFILE, method, urlPath, json);
    assert.equal(answer.status, 500, `${method} ${urlPath}`);
    assert.equal(answer.json.code, 'INVALID_PROFILE', `${method} ${urlPath}`);
  }
});

test('an invalid order.json is 500 INVALID_QUEUE wherever the queue is needed', async () => {
  assert.equal((await as(BROKEN_QUEUE, 'GET', '/api/profile')).status, 200, 'the profile alone still works');
  /** @type {[string, string, unknown?][]} */
  const routes = [
    ['GET', '/api/next'], ['GET', '/api/queue'],
    ['POST', '/api/questions/two-sum/run', { language: 'python', code: TWO_SUM_PY }],
    ['POST', '/api/questions/two-sum/submit', { language: 'python', code: TWO_SUM_PY }],
    ['POST', '/api/questions/two-sum/skip', { language: 'python', code: '' }],
  ];
  for (const [method, urlPath, json] of routes) {
    const answer = await as(BROKEN_QUEUE, method, urlPath, json);
    assert.equal(answer.status, 500, `${method} ${urlPath}`);
    assert.equal(answer.json.code, 'INVALID_QUEUE', `${method} ${urlPath}`);
  }
});

test('no error answer names a path on the server (#85)', async () => {
  // NO_FOLDER's users/<email> is a plain file, so every read of their files
  // fails with ENOTDIR, whose message holds the file's full path.
  /** @type {[string, string, unknown?][]} */
  const routes = [
    ['GET', '/api/profile'], ['GET', '/api/next'], ['GET', '/api/queue'], ['GET', '/api/submissions'],
    ['POST', '/api/questions/two-sum/run', { language: 'python', code: TWO_SUM_PY }],
    ['POST', '/api/questions/two-sum/submit', { language: 'python', code: TWO_SUM_PY }],
    ['POST', '/api/questions/two-sum/skip', { language: 'python', code: '' }],
    ['PATCH', '/api/profile/preferred', { languages: ['python'] }],
  ];
  for (const [method, urlPath, json] of routes) {
    const answer = await as(NO_FOLDER, method, urlPath, json);
    assert.ok(answer.status >= 400, `${method} ${urlPath} fails: ${answer.status}`);
    const body = answer.body.toString();
    assert.ok(!body.includes(tmp) && !body.includes(REPO), `${method} ${urlPath} names a path: ${body}`);
  }
});

// ---- Judging refused when the sandbox doesn't work (contract 2) ----

test('without a working sandbox, Run, Submit and Test are 503, not 500', async (t) => {
  // A second server, without MAXRECALL_UNSANDBOXED. Where the sandbox works
  // (Kubuntu, the VPS) there's nothing to refuse, so this is skipped there.
  const usersDir = path.join(tmp, 'users-b');
  const authDir = path.join(tmp, 'auth-b');
  fs.mkdirSync(authDir, { recursive: true, mode: 0o700 });
  const second = await startServer(usersDir, authDir, false);
  try {
    if (!second.log.some((l) => l.startsWith('Sandbox: UNAVAILABLE'))) {
      t.skip('the sandbox works here');
      return;
    }
    for (const mode of ['run', 'submit', 'test']) {
      const answer = await send(second.trusted, 'POST', `/api/questions/two-sum/${mode}`, { json: { language: 'python', code: TWO_SUM_PY } });
      assert.equal(answer.status, 503, `${mode}: ${answer.body}`);
      assert.match(answer.json.error, /^Judging is turned off on this server because its sandbox isn't working/);
    }
  } finally {
    await stopServer(second);
  }
});

// ---- Fill-in-the-blank questions, end to end (#160 step 4; owner, 2026-11-09) ----
//
// A second server on a folder of test questions (MAXRECALL_QUESTIONS_DIR,
// PR 198), with a users folder marked TEST-USERS (users.js,
// testBankRefusal). The rest of this file keeps the repo's questions/.

describe(
  'fill-in-the-blank questions, through a server on a test question bank',
  /**
   * Declares the block's tests, and the hooks that start and stop its server.
   *
   * @returns {void}
   */
  () => {
    /** @type {string} */
    let bankTmp = '';
    /** @type {RunningServer} */
    let bankServer;
    /** A fill-in-the-blank question, as the format allows (checked below). */
    const QUOTE = {
      slug: 'zz-quote', created: '2026-11-09T00:00:00Z', title: 'ZZ quote', difficulty: 'Fundamentals', topics: ['strings'], sources: ['test'],
      kind: 'fill-in-the-blank', description: { python: '<p>Fill in the blank.</p>' }, template: { python: 'print("It___s")' }, blank: '___', maxLength: 3,
    };
    // Judges as questions' R1 asks (docs/roles/questions.md): strict, own
    // names only, synchronous.
    const QUOTE_JUDGE = "'use strict';\nmodule.exports = {\n  judge(blank) {\n    return blank === \"'\" ? { pass: true, message: 'Yes: a single quote.' } : { pass: false, message: 'Not a single quote.', hints: ['One character.'] };\n  },\n};\n";
    const BROKEN = { ...QUOTE, slug: 'zz-broken', title: 'ZZ broken' };
    const BROKEN_JUDGE = "'use strict';\nmodule.exports = {\n  judge() {\n    throw new Error('this judge is broken on purpose');\n  },\n};\n";
    const QUIZ = { ...QUOTE, slug: 'zz-quiz', title: 'ZZ quiz', kind: 'quiz' };

    /**
     * Sends a request to the test bank's server as the owner, on its trusted
     * port (no sign-in).
     *
     * @param {string} method - The HTTP method.
     * @param {string} urlPath - The path.
     * @param {unknown} [json] - A body sent as JSON, if any.
     * @returns {Promise<Answer>} The answer.
     */
    const toBank = (method, urlPath, json) => send(bankServer.trusted, method, urlPath, { json });

    before(
      /**
       * Writes the test bank and a marked users folder, and starts its server.
       *
       * @returns {Promise<void>} Once it's listening.
       */
      async () => {
        bankTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maxrecall-routes-test-bank-'));
        const questionsDir = path.join(bankTmp, 'questions');
        const usersDir = path.join(bankTmp, 'users');
        const authDir = path.join(bankTmp, 'auth');
        writeFile(path.join(questionsDir, 'zz-quote.json'), QUOTE);
        writeFile(path.join(questionsDir, 'zz-quote.judge.js'), QUOTE_JUDGE);
        writeFile(path.join(questionsDir, 'zz-broken.json'), BROKEN);
        writeFile(path.join(questionsDir, 'zz-broken.judge.js'), BROKEN_JUDGE);
        writeFile(path.join(questionsDir, 'zz-quiz.json'), QUIZ);
        writeFile(path.join(usersDir, 'TEST-USERS'), '');
        fs.mkdirSync(authDir, { recursive: true, mode: 0o700 });
        bankServer = await startServer(usersDir, authDir, false, questionsDir);
      },
    );
    after(
      /**
       * Stops the server and removes its folders.
       *
       * @returns {Promise<void>} Once done.
       */
      async () => {
        if (bankServer) await stopServer(bankServer);
        if (bankTmp) fs.rmSync(bankTmp, { recursive: true, force: true });
      },
    );

    test('the fixtures are what the format allows (but the unknown kind, on purpose)', () => {
      assert.deepEqual(checkQuestion(QUOTE, 'zz-quote.json'), []);
      assert.deepEqual(checkQuestion(BROKEN, 'zz-broken.json'), []);
    });

    test('the server reads the test bank, not the repo\'s questions/', async () => {
      assert.equal((await toBank('GET', '/api/questions/two-sum')).status, 404);
      const listed = (await toBank('GET', '/api/questions')).json.map((/** @type {{ slug: string }} */ q) => q.slug).sort();
      assert.deepEqual(listed, ['zz-broken', 'zz-quiz', 'zz-quote']);
    });

    test('the public view: kind, template, blank and maxLength; nothing of the judge', async () => {
      const one = await toBank('GET', '/api/questions/zz-quote');
      assert.equal(one.status, 200);
      assert.equal(one.json.kind, 'fill-in-the-blank');
      assert.deepEqual(one.json.template, QUOTE.template);
      assert.equal(one.json.blank, '___');
      assert.equal(one.json.maxLength, 3);
      assert.doesNotMatch(one.body.toString(), /judge|single quote/i, 'nothing of the judge file');
      const quiz = await toBank('GET', '/api/questions/zz-quiz');
      assert.deepEqual(Object.keys(quiz.json).sort(), ['description', 'difficulty', 'kind', 'slug', 'sources', 'title', 'topics']);
    });

    test('Run: a right and a wrong answer, judged by the question\'s judge; no counts, nothing recorded', async () => {
      const right = await toBank('POST', '/api/questions/zz-quote/run', { language: 'python', answer: { blank: "'" } });
      assert.equal(right.status, 200, right.body.toString());
      assert.deepEqual(right.json, { status: 'Accepted', message: 'Yes: a single quote.' });
      const wrong = await toBank('POST', '/api/questions/zz-quote/run', { language: 'python', answer: { blank: '"' } });
      assert.deepEqual(wrong.json, { status: 'Wrong Answer', message: 'Not a single quote.', hints: ['One character.'] });
      assert.ok(!fs.existsSync(path.join(bankTmp, 'users', OWNER, 'submissions')), 'a Run isn\'t recorded');
    });

    test('Run: the answer is checked before judging (contract 2): 400s', async () => {
      /** @type {[string, unknown, RegExp][]} */
      const refused = [
        ['code in place of answer', { language: 'python', code: "'" }, /answer must be an object/],
        ['blank an array', { language: 'python', answer: { blank: ["'"] } }, /blank must be a string/],
        ['blank { length: 1 }', { language: 'python', answer: { blank: { length: 1 } } }, /blank must be a string/],
        ['over maxLength 3', { language: 'python', answer: { blank: 'abcd' } }, /at most 3 characters/],
        ['another field', { language: 'python', answer: { blank: "'", extra: 1 } }, /one field, blank, and no other/],
        ['a language the template lacks', { language: 'javascript', answer: { blank: "'" } }, /doesn't support javascript/],
      ];
      for (const [name, body, message] of refused) {
        const answer = await toBank('POST', '/api/questions/zz-quote/run', body);
        assert.equal(answer.status, 400, name);
        assert.match(answer.json.error, message, name);
      }
    });

    test('Test is 400: for code questions only', async () => {
      const tested = await toBank('POST', '/api/questions/zz-quote/test', { language: 'python', answer: { blank: "'" } });
      assert.equal(tested.status, 400);
      assert.match(tested.json.error, /Test is for code questions only/);
      assert.ok(!fs.existsSync(path.join(bankTmp, 'users', OWNER, 'submissions')), 'nothing recorded');
    });

    /**
     * The owner's pair for zz-quote in Python, from the test bank's order.json.
     *
     * @returns {{ pass?: string, passesInARow: number } | undefined} The pair, if queued.
     */
    const quotePair = () => JSON.parse(fs.readFileSync(path.join(bankTmp, 'users', OWNER, 'order.json'), 'utf8'))
      .queue.find((/** @type {{ question: string, language: string }} */ p) => p.question === 'zz-quote' && p.language === 'python');

    /**
     * The SHA-256 of a file in the test bank, in hex.
     *
     * @param {string} name - The file's name.
     * @returns {string} Its hash.
     */
    const bankSha256 = (name) => crypto.createHash('sha256').update(fs.readFileSync(path.join(bankTmp, 'questions', name))).digest('hex');

    test('Submit: judged, saved as a version 4 record, and the queue moved', async () => {
      const wrong = await toBank('POST', '/api/questions/zz-quote/submit', { language: 'python', answer: { blank: '"' }, elapsedMs: 4000 });
      assert.equal(wrong.status, 200, wrong.body.toString());
      assert.equal(wrong.json.status, 'Wrong Answer');
      assert.deepEqual([wrong.json.pass, wrong.json.saved, wrong.json.queueUpdated], ['no', true, true]);
      assert.equal(quotePair()?.pass, 'no');

      const right = await toBank('POST', '/api/questions/zz-quote/submit', { language: 'python', answer: { blank: "'" }, elapsedMs: 5000 });
      assert.equal(right.json.status, 'Accepted');
      assert.equal(right.json.message, 'Yes: a single quote.');
      assert.deepEqual([right.json.pass, right.json.saved, right.json.queueUpdated], ['yes', true, true]);
      assert.equal(right.json.judgeSha256, undefined, 'the judge\'s hash stays on the server');
      assert.equal(quotePair()?.pass, 'yes');
      assert.equal(quotePair()?.passesInARow, 1);

      // The record (docs/plans/submission-records-v4.md): kind, answer and
      // no code (D1, D2); the judge's message (D3); nulls (D4); judgeSha256 (D6).
      const record = (await toBank('GET', `/api/submissions/${right.json.submissionId}`)).json;
      assert.deepEqual(Object.keys(record), ['id', 'schemaVersion', 'submittedAt', 'question', 'questionSha256', 'judgeSha256', 'language', 'kind', 'answer', 'status', 'message', 'passed', 'total', 'runtimeMs', 'elapsedMs', 'results', 'stdout', 'stderr']);
      assert.equal(record.schemaVersion, 4);
      assert.equal(record.kind, 'fill-in-the-blank');
      assert.deepEqual(record.answer, { blank: "'" });
      assert.equal(record.questionSha256, bankSha256('zz-quote.json'));
      assert.equal(record.judgeSha256, bankSha256('zz-quote.judge.js'), 'the judge file\'s hash');
      assert.deepEqual([record.passed, record.total, record.runtimeMs, record.stdout, record.stderr], [null, null, null, null, null]);
      assert.deepEqual(record.results, []);
      assert.equal(record.elapsedMs, 5000);
      const wrongRecord = (await toBank('GET', `/api/submissions/${wrong.json.submissionId}`)).json;
      assert.deepEqual(wrongRecord.hints, ['One character.'], 'hints kept (D3)');

      const summaries = (await toBank('GET', '/api/submissions?question=zz-quote&language=python')).json;
      assert.deepEqual(summaries.map((/** @type {{ kind: string, status: string, message: string, passed: null }} */ s) => [s.kind, s.status, s.message, s.passed]),
        [['fill-in-the-blank', 'Accepted', 'Yes: a single quote.', null], ['fill-in-the-blank', 'Wrong Answer', 'Not a single quote.', null]]);
      assert.deepEqual(summaries.map((/** @type {{ answer: { blank: string } }} */ s) => s.answer), [{ blank: "'" }, { blank: '"' }], 'what was typed, for the Submissions tab');
    });

    test('Skip: saves what the box held, and moves the queue as a fail', async () => {
      const asked = await toBank('POST', '/api/questions/zz-quote/skip', { language: 'python', answer: { blank: 'x' } });
      assert.equal(asked.status, 409, 'a streak of 1 needs confirming');
      const refused = await toBank('POST', '/api/questions/zz-quote/skip', { language: 'python', answer: { blank: 'toolong' }, confirmed: true });
      assert.equal(refused.status, 400, 'the box is checked as for Submit');
      const skipped = await toBank('POST', '/api/questions/zz-quote/skip', { language: 'python', answer: { blank: 'x' }, confirmed: true });
      assert.equal(skipped.status, 200, skipped.body.toString());
      assert.equal(skipped.json.saved, true);
      const record = (await toBank('GET', `/api/submissions/${skipped.json.submissionId}`)).json;
      assert.equal(record.kind, 'fill-in-the-blank');
      assert.equal(record.skipped, 'yes');
      assert.deepEqual(record.answer, { blank: 'x' });
      assert.equal(record.status, null);
      assert.ok(!('message' in record) && !('code' in record));
      assert.equal(record.judgeSha256, null, 'a Skip judges nothing, so no judge hash (owner, 2026-11-09, A)');
      assert.equal(quotePair()?.passesInARow, 0);
    });

    test('a judge that throws: 500 "couldn\'t judge", the details only in the log, and a Submit records nothing', async () => {
      const failed = await toBank('POST', '/api/questions/zz-broken/run', { language: 'python', answer: { blank: "'" } });
      assert.equal(failed.status, 500);
      assert.deepEqual(failed.json, { error: COULDNT_JUDGE });
      assert.ok(bankServer.log.some((l) => /The judge for zz-broken failed: it threw: Error: this judge is broken on purpose/.test(l)), bankServer.log.join('\n'));
      /**
       * The owner's queue files in the test bank's users folder, as text.
       *
       * @returns {string[]} order.json's and backlog.json's contents.
       */
      const queueFiles = () => ['order.json', 'backlog.json'].map((f) => fs.readFileSync(path.join(bankTmp, 'users', OWNER, f), 'utf8'));
      const before = queueFiles();
      const submitted = await toBank('POST', '/api/questions/zz-broken/submit', { language: 'python', answer: { blank: "'" } });
      assert.equal(submitted.status, 500);
      assert.deepEqual(submitted.json, { error: COULDNT_JUDGE });
      assert.equal((await toBank('GET', '/api/submissions?question=zz-broken')).json.length, 0, 'not recorded');
      assert.deepEqual(queueFiles(), before, 'the queue files are unchanged');
    });

    test('a kind the server doesn\'t know: 501 for Run', async () => {
      const answer = await toBank('POST', '/api/questions/zz-quiz/run', { language: 'python', answer: { blank: "'" } });
      assert.equal(answer.status, 501);
      assert.match(answer.json.error, /can't answer a question of this kind \("quiz"\)/);
    });
  },
);

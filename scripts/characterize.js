#!/usr/bin/env node
'use strict';
// The characterization check: records how the server behaves (status,
// Content-Type, the JSON's keys and its stable values, what file a non-JSON
// body is) for about 244 requests, and what it logs. Written for
// docs/plans/server-split.md, step 1, to show the split changed nothing;
// kept for any refactor meant to change no behaviour (owner, 2026-11-06,
// option C). Run by hand, not by make test: it fails on any change at all,
// a new question included. make test runs routes.test.js, the assertions
// that matter, instead.
//
// Record before and after the change, from two checkouts or one checkout
// at two commits, on the same machine, then diff the two outputs:
//
//   node scripts/characterize.js <repo> <output-file>
//
// It starts `node server.js` from <repo> twice, with throwaway users/ and
// auth/ folders in a temporary directory, on free ports:
//   A. MAXRECALL_UNSANDBOXED=1, for every route (it lets the server judge
//      where the sandbox doesn't work, as in the cloud, and never turns a
//      working one off: judge/sandbox.js);
//   B. without it, for the 503 a Run gets when the sandbox doesn't work
//      (only where bubblewrap is missing or broken, as in the cloud).
// Its start-up log lines name the machine's sandbox and core count, hence
// "on the same machine".

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const REPO = path.resolve(process.argv[2] || '.');
const OUT = process.argv[3];
if (!OUT) {
  console.error('usage: node characterize.js <repo> <output-file>');
  process.exit(2);
}

const OWNER = 'owner@example.com';
const LEARNER = 'learner.a@example.com';
const BROKEN_PROFILE = 'broken.profile@example.com';
const BROKEN_QUEUE = 'broken.queue@example.com';
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

// JSON values kept as they are; every other primitive is recorded by type
// only, since times, ids, runtimes and output change from run to run.
const KEEP_VALUES = new Set([
  'status', 'error', 'code', 'saved', 'queueUpdated', 'tested', 'trusted', 'email', 'passed', 'total',
  'hiddenCount', 'where', 'language', 'question', 'backlog', 'slug', 'title', 'difficulty', 'revealed',
  'hidden', 'skipped', 'canTestQuestions', 'defaultLanguage', 'ok', 'pass', 'passesInARow',
  'allowedLanguages', 'languages', 'canChooseLanguages', 'canSwitchLanguage', 'canSetDefaultLanguage',
]);

/** @type {string[]} */
const lines = [];
/** @type {Map<string, string>} */
let normalizers = new Map();

/**
 * Replaces what changes between runs (the temporary folder, ports, times,
 * submission ids, process ids) with fixed placeholders.
 *
 * @param {string} text - Any recorded text.
 * @returns {string} The text with placeholders.
 */
function normalize(text) {
  let out = text;
  for (const [from, to] of normalizers) out = out.split(from).join(to);
  return out
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}[-:]\d{2}[-:]\d{2}(\.\d+)?Z/g, '<time>')
    .replace(/judge-helpers-\d+-\w+/g, 'judge-helpers-<pid>-<x>')
    .replace(/\.tmp-\d+/g, '.tmp-<pid>')
    .replace(/before-recalculate-<time>/g, 'before-recalculate-<time>');
}

/**
 * Records one line of output.
 *
 * @param {string} text - The line.
 * @returns {void}
 */
function record(text) {
  lines.push(normalize(text));
}

/**
 * Describes a JSON value without the parts that change from run to run:
 * objects by their sorted keys, arrays by length and their elements'
 * distinct descriptions (sorted, so order inside the array doesn't matter),
 * primitives by type, or by value when their key is in KEEP_VALUES.
 *
 * @param {unknown} value - A parsed JSON value.
 * @param {string} [key] - The key it was found under, if any.
 * @returns {unknown} The description, itself JSON.
 */
function shape(value, key) {
  if (value === null) return null;
  if (Array.isArray(value)) {
    const keep = key !== undefined && KEEP_VALUES.has(key);
    const items = [...new Set(value.map((v) => JSON.stringify(keep ? v : shape(v))))].sort();
    return { array: value.length, of: items.map((s) => JSON.parse(s)) };
  }
  if (typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const k of Object.keys(/** @type {object} */ (value)).sort()) {
      out[k] = shape(/** @type {Record<string, unknown>} */ (value)[k], k);
    }
    return out;
  }
  if (key !== undefined && KEEP_VALUES.has(key)) return value;
  return `<${typeof value}>`;
}

/** @type {Map<string, string>} */
const knownFiles = new Map();

/**
 * Hashes every file a body might turn out to be, so a served body can be
 * named ("= index.html") instead of hashed.
 *
 * @returns {void}
 */
function hashKnownFiles() {
  for (const name of fs.readdirSync(REPO)) {
    const file = path.join(REPO, name);
    if (!fs.statSync(file).isFile()) continue;
    knownFiles.set(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), name);
  }
}

/**
 * A free TCP port on 127.0.0.1.
 *
 * @returns {Promise<number>} The port.
 */
function freePort() {
  return new Promise(
    /**
     * Listens on port 0, so the system picks a free port.
     *
     * @param {(value: any) => void} resolve - Settles the promise with its value.
     * @param {(err: Error) => void} reject - Fails it.
     * @returns {void}
     */
    (resolve, reject) => {
      const server = net.createServer();
      server.on('error', reject);
      server.listen(
        0,
        '127.0.0.1',
        /**
         * Reads the port, then closes the listener.
         *
         * @returns {void}
         */
        () => {
          const { port } = /** @type {net.AddressInfo} */ (server.address());
          server.close(() => resolve(port));
        },
      );
    },
  );
}

/**
 * The server process and its output so far.
 *
 * @typedef {object} RunningServer
 * @property {import('child_process').ChildProcess} child
 * @property {string[]} log - Lines it has printed (stdout and stderr).
 */

/**
 * Starts `node server.js` and waits until it's listening (and, if
 * TRUSTED_PORT is set, the trusted listener too).
 *
 * @param {NodeJS.ProcessEnv} env - Its environment.
 * @returns {Promise<RunningServer>} The running server.
 * @throws {Error} If it exits or takes over 120 s to listen.
 */
function startServer(env) {
  return new Promise(
    /**
     * Spawns the server and watches its output.
     *
     * @param {(value: any) => void} resolve - Settles the promise with its value.
     * @param {(err: Error) => void} reject - Fails it.
     * @returns {void}
     */
    (resolve, reject) => {
      const child = spawn(process.execPath, ['server.js'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
      /** @type {string[]} */
      const log = [];
      let pending = '';
      const timer = setTimeout(
        /**
         * Gives up, stopping the server: left running, it would keep this
         * script from exiting.
         *
         * @returns {void}
         */
        () => {
          child.removeAllListeners('exit');
          child.kill('SIGKILL');
          reject(new Error(`server didn't start:\n${log.join('\n')}`));
        },
        120000,
      );
      /**
       * Collects output line by line and resolves once it's listening.
       *
       * @param {Buffer} chunk - Output.
       * @returns {void}
       */
      const onData = (chunk) => {
        pending += chunk.toString();
        const parts = pending.split('\n');
        pending = parts.pop() || '';
        log.push(...parts);
        const listening = log.some((l) => l.startsWith('Server listening'));
        const trusted = !env.TRUSTED_PORT || log.some((l) => l.startsWith('Trusted listener'));
        if (listening && trusted) {
          clearTimeout(timer);
          resolve({ child, log });
        }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on(
        'exit',
        /**
         * Fails the start if the server exits first.
         *
         * @param {number | null} code - Its exit status.
         * @returns {void}
         */
        (code) => {
          clearTimeout(timer);
          reject(new Error(`server exited with ${code}:\n${log.join('\n')}`));
        },
      );
    },
  );
}

/**
 * Waits until the server's start-up work is over: the consistency check's
 * totals line (logConsistency() runs after the server starts listening,
 * since it awaits), then 500 ms with no new output.
 *
 * @param {RunningServer} server - The server.
 * @returns {Promise<number>} How many lines the start-up log has.
 * @throws {Error} If the totals line doesn't come within 60 s.
 */
async function settle(server) {
  const started = Date.now();
  while (!server.log.some((l) => /^Consistency: (\d+ users? checked|not checked)/.test(l))) {
    if (Date.now() - started > 60000) throw new Error(`no Consistency line:\n${server.log.join('\n')}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  let count = -1;
  while (count !== server.log.length) {
    count = server.log.length;
    await new Promise((r) => setTimeout(r, 500));
  }
  return count;
}

/**
 * Stops the server and waits for it to exit.
 *
 * @param {RunningServer} server - The server.
 * @returns {Promise<void>} Once it has exited.
 */
function stopServer(server) {
  return new Promise(
    /**
     * Stops the server once its exit is being watched.
     *
     * @param {(value?: void) => void} resolve - Settles the promise.
     * @returns {void}
     */
    (resolve) => {
      server.child.removeAllListeners('exit');
      server.child.on('exit', () => resolve());
      server.child.kill('SIGTERM');
    },
  );
}

/**
 * One HTTP answer.
 *
 * @typedef {object} Answer
 * @property {number} status
 * @property {http.IncomingHttpHeaders} headers
 * @property {Buffer} body
 */

/**
 * Sends one request, the path exactly as given (no URL normalizing).
 *
 * @param {number} port - Port on 127.0.0.1.
 * @param {string} method - HTTP method.
 * @param {string} urlPath - The path, sent as is.
 * @param {{ json?: unknown, raw?: string, contentType?: string, cookie?: string, host?: string, headers?: Record<string, string>, timedRetryAfter?: boolean }} [options] -
 *   json: a body sent as JSON; raw: a body sent as text/plain (or
 *   contentType); cookie: the session cookie's value; host: another
 *   address than 127.0.0.1; headers: extra request headers;
 *   timedRetryAfter: Retry-After depends on timing, so check() records
 *   only that it's set.
 * @returns {Promise<Answer>} The answer.
 */
function send(port, method, urlPath, options = {}) {
  return new Promise(
    /**
     * Sends the request and collects the answer.
     *
     * @param {(value: any) => void} resolve - Settles the promise with its value.
     * @param {(err: Error) => void} reject - Fails it.
     * @returns {void}
     */
    (resolve, reject) => {
      /** @type {http.OutgoingHttpHeaders} */
      const headers = { connection: 'close', ...options.headers };
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
      const req = http.request(
        { host: options.host || '127.0.0.1', port, method, path: urlPath, headers },
        /**
         * Collects the body, then resolves with the answer.
         *
         * @param {http.IncomingMessage} res - The response.
         * @returns {void}
         */
        (res) => {
        /** @type {Buffer[]} */
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks) }));
        },
      );
      req.on('error', reject);
      if (body !== undefined) req.write(body);
      req.end();
    },
  );
}

/**
 * Describes a body: its JSON's shape, the repository file it equals, or
 * its hash and length.
 *
 * @param {Answer} answer - The answer.
 * @returns {string} The description.
 */
function describeBody(answer) {
  if (answer.body.length === 0) return 'empty';
  const type = String(answer.headers['content-type'] || '');
  if (type.includes('json')) {
    try {
      return `json ${JSON.stringify(shape(JSON.parse(answer.body.toString())))}`;
    } catch {
      return 'invalid json';
    }
  }
  const hash = crypto.createHash('sha256').update(answer.body).digest('hex');
  const file = knownFiles.get(hash);
  return file ? `= ${file}` : `sha256:${hash.slice(0, 16)} (${answer.body.length} bytes)`;
}

/**
 * The session cookie's value set by an answer, if any.
 *
 * @param {Answer} answer - The answer.
 * @returns {string | null} The cookie's value, or null.
 */
function sessionCookieOf(answer) {
  for (const c of answer.headers['set-cookie'] || []) {
    const m = /^maxrecall_session=([^;]*)/.exec(c);
    if (m && m[1]) return m[1];
  }
  return null;
}

/**
 * Sends a request and records its answer as one line: who, method and
 * path, status, Content-Type, the headers that matter, and the body's
 * description.
 *
 * @param {string} who - Label for who's asking (e.g. "anon@PORT").
 * @param {number} port - Port on 127.0.0.1.
 * @param {string} method - HTTP method.
 * @param {string} urlPath - The path.
 * @param {Parameters<typeof send>[3]} [options] - As for send().
 * @returns {Promise<Answer>} The answer, for requests that depend on it.
 */
async function check(who, port, method, urlPath, options = {}) {
  const answer = await send(port, method, urlPath, options);
  const extras = [];
  if (answer.headers.location) extras.push(`location=${answer.headers.location}`);
  if (answer.headers['retry-after']) extras.push(`retry-after=${options.timedRetryAfter ? '<set>' : answer.headers['retry-after']}`);
  for (const c of answer.headers['set-cookie'] || []) {
    extras.push(`set-cookie=${c.replace(/^(maxrecall_session=)[^;]+/, '$1<token>').replace(/Expires=[^;]+/, 'Expires=<time>')}`);
  }
  const sent = options.json !== undefined ? ` json=${JSON.stringify(options.json && typeof options.json === 'object' ? Object.keys(options.json).sort() : typeof options.json)}` : options.raw !== undefined ? ` raw(${options.contentType || 'text/plain'})` : '';
  record(`${who} ${method} ${urlPath}${sent} -> ${answer.status} ${answer.headers['content-type'] || '-'}${extras.length ? ` ${extras.join(' ')}` : ''} | ${describeBody(answer)}`);
  return answer;
}

/**
 * Writes a JSON file, making its folder.
 *
 * @param {string} file - The file.
 * @param {unknown} value - Its content, or a string written as is.
 * @returns {void}
 */
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Makes invite codes with auth.js's createInvite, in a child process so
 * auth.js reads MAXRECALL_AUTH_DIR as the server will.
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
 * Records the users folder: every file (submission times as <time>), and
 * the JSON files' content. A queue's elements are recorded sorted, since
 * advance.js moves a passed pair down 1 or 2 places at random.
 *
 * @param {string} usersDir - The users folder.
 * @returns {void}
 */
function recordUsersDir(usersDir) {
  /**
   * Every file under a folder, relative to usersDir, sorted.
   *
   * @param {string} dir - The folder.
   * @returns {string[]} The files.
   */
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(
    /**
     * One entry: a file's path, or every file under a folder.
     *
     * @param {fs.Dirent} d - The entry.
     * @returns {string[]} The paths.
     */
    (d) => {
    const full = path.join(dir, d.name);
    return d.isDirectory() ? walk(full) : [path.relative(usersDir, full)];
    },
  ).sort();
  for (const rel of walk(usersDir)) {
    const text = fs.readFileSync(path.join(usersDir, rel), 'utf8');
    if (rel.includes('/submissions/')) {
      record(`  file ${rel} ${describeBody({ status: 200, headers: { 'content-type': 'json' }, body: Buffer.from(text) })}`);
      continue;
    }
    let content = text.trim();
    try {
      const value = JSON.parse(text);
      if (Array.isArray(value.queue)) value.queue = [...value.queue].map((e) => JSON.stringify(e)).sort().map((e) => JSON.parse(e));
      content = JSON.stringify(value);
    } catch { /* invalid on purpose: recorded as it is */ }
    record(`  file ${rel} ${content}`);
  }
}

/**
 * Records which addresses a port accepts connections on: 127.0.0.1, and
 * each non-loopback IPv4 address of this machine.
 *
 * @param {string} name - Label for the port.
 * @param {number} port - The port.
 * @returns {Promise<void>} Once recorded.
 */
async function recordBinding(name, port) {
  const addresses = ['127.0.0.1', ...Object.values(os.networkInterfaces()).flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => /** @type {os.NetworkInterfaceInfo} */ (a).address)];
  for (const host of addresses) {
    const result = await new Promise(
      /**
       * Tries to connect, and settles with what happened.
       *
       * @param {(value: string) => void} resolve - Settles with "accepts",
       *   "refuses (<code>)" or "timeout".
       * @returns {void}
       */
      (resolve) => {
        const socket = net.connect({ host, port });
        socket.setTimeout(2000);
        socket.on(
          'connect',
          /**
           * Connected: the port accepts on this address.
           *
           * @returns {void}
           */
          () => {
            socket.destroy();
            resolve('accepts');
          },
        );
        socket.on('error', (err) => resolve(`refuses (${/** @type {NodeJS.ErrnoException} */ (err).code})`));
        socket.on(
          'timeout',
          /**
           * No answer within 2 s.
           *
           * @returns {void}
           */
          () => {
            socket.destroy();
            resolve('timeout');
          },
        );
      },
    );
    record(`bind ${name} on ${host === '127.0.0.1' ? '127.0.0.1' : 'non-loopback'}: ${result}`);
  }
}

/**
 * Phase A: every route, judging unsandboxed.
 *
 * @param {string} tmp - The temporary folder.
 * @returns {Promise<void>} Once recorded.
 */
async function phaseA(tmp) {
  const usersDir = path.join(tmp, 'users');
  const authDir = path.join(tmp, 'auth');
  const PORT = await freePort();
  let TRUSTED = await freePort();
  while (TRUSTED === PORT) TRUSTED = await freePort();
  normalizers = new Map([[tmp, '<TMP>'], [`:${TRUSTED}`, ':<TRUSTED>'], [`:${PORT}`, ':<PORT>'], [` ${TRUSTED} `, ' <TRUSTED> '], [` ${PORT} `, ' <PORT> ']]);

  // Before start: a learner with two languages and a queue (prepareQueues
  // fills their backlog at start), and one whose order.json is invalid.
  writeJson(path.join(usersDir, LEARNER, 'profile.json'), { schemaVersion: 1, allowed: { languages: ['python', 'javascript'] } });
  writeJson(path.join(usersDir, LEARNER, 'order.json'), { schemaVersion: 1, submitsSinceLastIntroduced: 0, queue: [{ question: 'two-sum', language: 'python', passesInARow: 0 }] });
  writeJson(path.join(usersDir, BROKEN_QUEUE, 'profile.json'), { schemaVersion: 1, allowed: { languages: ['python'] } });
  writeJson(path.join(usersDir, BROKEN_QUEUE, 'order.json'), '{ not json\n');
  fs.mkdirSync(authDir, { recursive: true, mode: 0o700 });
  const invites = makeInvites(authDir, [LEARNER, BROKEN_PROFILE, BROKEN_QUEUE]);

  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8',
    PORT: String(PORT), TRUSTED_PORT: String(TRUSTED),
    MAXRECALL_USER: OWNER, MAXRECALL_USERS_DIR: usersDir, MAXRECALL_AUTH_DIR: authDir,
    MAXRECALL_UNSANDBOXED: '1',
  };
  const server = await startServer(env);
  try {
    const startupLines = await settle(server);
    record('== A. startup log ==');
    for (const l of server.log.slice(0, startupLines)) record(`  log ${l}`);
    record('== A. users folder after startup ==');
    recordUsersDir(usersDir);

    record('== A. bindings ==');
    await recordBinding('PORT', PORT);
    await recordBinding('TRUSTED_PORT', TRUSTED);

    const anon = 'anon@PORT';
    record('== A. signed out, on PORT ==');
    for (const p of ['/login.html', '/login-page.js', '/style.css']) await check(anon, PORT, 'GET', p);
    for (const p of ['/', '/index.html', '/problem.html?slug=two-sum&language=python', '/account.js', '/labels.json', '/server.js', '/nonexistent']) await check(anon, PORT, 'GET', p);
    await check(anon, PORT, 'HEAD', '/');
    await check(anon, PORT, 'PUT', '/index.html');
    for (const p of ['/api/auth/me', '/api/questions', '/api/questions/two-sum', '/api/profile', '/api/next', '/api/queue', '/api/submissions', '/api/nope', '/api/']) await check(anon, PORT, 'GET', p);
    await check(anon, PORT, 'POST', '/api/questions/two-sum/run', { json: { language: 'python', code: TWO_SUM_PY } });
    await check(anon, PORT, 'PATCH', '/api/profile/preferred', { json: { languages: ['python'] } });
    record('== A. the JSON-only rule (signed out) ==');
    await check(anon, PORT, 'POST', '/api/questions/two-sum/run', { raw: 'language=python' , contentType: 'application/x-www-form-urlencoded' });
    await check(anon, PORT, 'POST', '/api/auth/logout', { raw: '' });
    await check(anon, PORT, 'POST', '/api/auth/login', { raw: 'email=a&password=b', contentType: 'application/x-www-form-urlencoded' });
    await check(anon, PORT, 'PATCH', '/api/profile/preferred', { raw: '{}' });
    await check(anon, PORT, 'POST', '/notapi', { raw: 'x' });

    record('== A. registering and signing in ==');
    await check(anon, PORT, 'POST', '/api/auth/register', { json: { email: LEARNER, password: PASSWORD } });
    await check(anon, PORT, 'POST', '/api/auth/register', { json: { email: LEARNER, invite: invites[LEARNER], password: 'short' } });
    await check(anon, PORT, 'POST', '/api/auth/register', { json: { email: LEARNER, invite: 'wrong-code', password: PASSWORD } });
    await check(anon, PORT, 'POST', '/api/auth/register', { json: { email: 42, invite: 'x', password: PASSWORD } });
    const registered = await check(anon, PORT, 'POST', '/api/auth/register', { json: { email: LEARNER, invite: invites[LEARNER], password: PASSWORD } });
    await check(anon, PORT, 'POST', '/api/auth/register', { json: { email: LEARNER, invite: invites[LEARNER], password: PASSWORD } });
    await check(anon, PORT, 'POST', '/api/auth/login', { json: { email: LEARNER, password: 'wrong password!!' } });
    await check(anon, PORT, 'POST', '/api/auth/login', { json: { email: LEARNER } });
    const loggedIn = await check(anon, PORT, 'POST', '/api/auth/login', { json: { email: LEARNER, password: PASSWORD } });
    const cookie = sessionCookieOf(loggedIn) || '';
    const oldCookie = sessionCookieOf(registered) || '';
    await check('stale-cookie@PORT', PORT, 'GET', '/api/auth/me', { cookie: oldCookie });
    // Logging in again while sending the old cookie ends that old session.
    const again = await check('stale-cookie@PORT', PORT, 'POST', '/api/auth/login', { cookie: oldCookie, json: { email: LEARNER, password: PASSWORD } });
    await check('stale-cookie@PORT', PORT, 'GET', '/api/auth/me', { cookie: oldCookie });
    await check('new-cookie@PORT', PORT, 'GET', '/api/auth/me', { cookie: sessionCookieOf(again) || '' });
    await check('bad-cookie@PORT', PORT, 'GET', '/api/auth/me', { cookie: 'not-a-token' });
    record('-- trust proxy: HTTPS as nginx reports it, from loopback --');
    await check(anon, PORT, 'POST', '/api/auth/login', { headers: { 'x-forwarded-proto': 'https' }, json: { email: LEARNER, password: PASSWORD } });
    record('-- throttling: 6 failed logins for one email --');
    for (let i = 0; i < 6; i++) await check(anon, PORT, 'POST', '/api/auth/login', { timedRetryAfter: true, json: { email: 'nobody@example.com', password: 'wrong password!!' } });
    const bp = sessionCookieOf(await check(anon, PORT, 'POST', '/api/auth/register', { json: { email: BROKEN_PROFILE, invite: invites[BROKEN_PROFILE], password: PASSWORD } })) || '';
    const bq = sessionCookieOf(await check(anon, PORT, 'POST', '/api/auth/register', { json: { email: BROKEN_QUEUE, invite: invites[BROKEN_QUEUE], password: PASSWORD } })) || '';

    const me = 'learner@PORT';
    /** @type {Parameters<typeof send>[3]} */
    const c = { cookie };
    record('== A. signed in as a learner (python, javascript), on PORT ==');
    await check(me, PORT, 'GET', '/api/auth/me', c);
    await check(me, PORT, 'GET', '/api/profile', c);
    await check(me, PORT, 'GET', '/api/next', c);
    await check(me, PORT, 'GET', '/api/queue', c);
    await check(me, PORT, 'GET', '/api/questions', c);
    await check(me, PORT, 'GET', '/api/questions/two-sum', c);
    await check(me, PORT, 'GET', '/api/questions/hello-world', c);
    await check(me, PORT, 'GET', '/api/questions/nope', c);
    await check(me, PORT, 'GET', '/api/questions/..%2Fpackage', c);
    await check(me, PORT, 'GET', '/api/nope', c);
    await check(me, PORT, 'POST', '/api/nope', { ...c, json: {} });
    await check(me, PORT, 'DELETE', '/api/questions/two-sum', c);
    record('-- run --');
    await check(me, PORT, 'POST', '/api/questions/nope/run', { ...c, json: { language: 'python', code: TWO_SUM_PY } });
    await check(me, PORT, 'POST', '/api/questions/two-sum/run', { ...c, json: { language: 'klingon', code: TWO_SUM_PY } });
    await check(me, PORT, 'POST', '/api/questions/two-sum/run', { ...c, json: { language: 'python', code: '   ' } });
    await check(me, PORT, 'POST', '/api/questions/two-sum/run', { ...c, json: { language: 'python' } });
    await check(me, PORT, 'POST', '/api/questions/two-sum/run', { ...c, json: { language: 'java', code: 'class X {}' } });
    await check(me, PORT, 'POST', '/api/questions/two-sum/run', { ...c, json: { language: 'python', code: TWO_SUM_PY } });
    await check(me, PORT, 'POST', '/api/questions/two-sum/run', { ...c, json: { language: 'python', code: WRONG_PY } });
    await check(me, PORT, 'POST', '/api/questions/two-sum/run', { ...c, json: { language: 'javascript', code: TWO_SUM_JS } });
    record('-- test (not the owner) --');
    await check(me, PORT, 'POST', '/api/questions/two-sum/test', { ...c, json: { language: 'python', code: TWO_SUM_PY } });
    record('-- submit --');
    await check(me, PORT, 'POST', '/api/questions/two-sum/submit', { ...c, json: { language: 'python', code: TWO_SUM_PY, elapsedMs: -1 } });
    await check(me, PORT, 'POST', '/api/questions/two-sum/submit', { ...c, json: { language: 'python', code: TWO_SUM_PY, elapsedMs: 1.5 } });
    const submitted = await check(me, PORT, 'POST', '/api/questions/two-sum/submit', { ...c, json: { language: 'python', code: TWO_SUM_PY, elapsedMs: 1234 } });
    const submissionId = JSON.parse(submitted.body.toString()).submissionId;
    await check(me, PORT, 'GET', '/api/next', c);
    await check(me, PORT, 'GET', '/api/queue', c);
    await check(me, PORT, 'POST', '/api/questions/two-sum/submit', { ...c, json: { language: 'javascript', code: 'function twoSum() { return [0, 0]; }' } });
    record('-- skip --');
    await check(me, PORT, 'POST', '/api/questions/two-sum/skip', { ...c, json: { language: 'python', code: '', confirmed: 'yes' } });
    await check(me, PORT, 'POST', '/api/questions/two-sum/skip', { ...c, json: { language: 'python', code: '' } });
    await check(me, PORT, 'POST', '/api/questions/two-sum/skip', { ...c, json: { language: 'python', code: '', confirmed: false } });
    await check(me, PORT, 'POST', '/api/questions/two-sum/skip', { ...c, json: { language: 'python', code: 'x = 1', elapsedMs: 50, confirmed: true } });
    await check(me, PORT, 'POST', '/api/questions/two-sum/skip', { ...c, json: { language: 'python', code: 42 } });
    await check(me, PORT, 'POST', '/api/questions/two-sum/skip', { ...c, json: { language: 'java', code: '' } });
    record('-- submissions --');
    await check(me, PORT, 'GET', '/api/submissions', c);
    await check(me, PORT, 'GET', '/api/submissions?question=two-sum&language=python', c);
    await check(me, PORT, 'GET', '/api/submissions?question=two-sum&language=javascript', c);
    await check(me, PORT, 'GET', '/api/submissions?question=hello-world', c);
    await check(me, PORT, 'GET', '/api/submissions?language=klingon', c);
    await check(me, PORT, 'GET', '/api/submissions?question=a&question=b', c);
    await check(me, PORT, 'GET', `/api/submissions/${submissionId}`, c);
    await check(me, PORT, 'GET', '/api/submissions/2026-01-01T00-00-00.000Z', c);
    await check(me, PORT, 'GET', '/api/submissions/..%2F..%2Fprofile', c);
    record('-- profile --');
    await check(me, PORT, 'PATCH', '/api/profile/preferred', { ...c, json: { languages: ['javascript', 'python'] } });
    await check(me, PORT, 'PATCH', '/api/profile/preferred', { ...c, json: { defaultLanguage: 'java' } });
    await check(me, PORT, 'PATCH', '/api/profile/preferred', { ...c, json: { languages: ['cpp'] } });
    await check(me, PORT, 'PATCH', '/api/profile/preferred', { ...c, json: { colour: 'blue' } });
    await check(me, PORT, 'PATCH', '/api/profile/preferred', { ...c, json: { languages: ['python'], defaultLanguage: 'python' } });
    await check(me, PORT, 'PATCH', '/api/profile/preferred', { ...c, raw: '{}' });
    await check(me, PORT, 'GET', '/api/profile', c);
    await check(me, PORT, 'GET', '/api/queue', c);
    record('-- what is served, signed in --');
    const STATIC = ['index.html', 'style.css', 'problem.html', 'problems-list.js', 'problem-page.js', 'labels.json', 'bubbles.js', 'timer.js', 'login.html', 'login-page.js', 'account.js'];
    for (const f of STATIC) await check(me, PORT, 'GET', `/${f}`, c);
    const PROBES = ['/', '/server.js', '/routes.js', '/package.json', '/.env', '/.env.example', '/users/', `/users/${LEARNER}/profile.json`, '/auth/', '/questions/two-sum.json', '/question-files.js', '/judge/runner.js', '/%2e%2e/server.js', '/..%2Fserver.js', '/readme.html', '/docs/contracts.md', '/nonexistent', '/problem.html?slug=two-sum'];
    for (const p of PROBES) await check(me, PORT, 'GET', p, c);
    record('-- logging out --');
    await check(me, PORT, 'POST', '/api/auth/logout', c);
    await check(me, PORT, 'POST', '/api/auth/logout', { ...c, json: {} });
    await check(me, PORT, 'GET', '/api/auth/me', c);
    await check(me, PORT, 'GET', '/', c);

    record('== A. a learner whose profile.json is invalid ==');
    writeJson(path.join(usersDir, BROKEN_PROFILE, 'profile.json'), '{ "schemaVersion": 1, "colour": "blue" }\n');
    const b1 = { cookie: bp };
    await check('badprofile@PORT', PORT, 'GET', '/api/profile', b1);
    await check('badprofile@PORT', PORT, 'GET', '/api/next', b1);
    await check('badprofile@PORT', PORT, 'GET', '/api/queue', b1);
    await check('badprofile@PORT', PORT, 'POST', '/api/questions/two-sum/run', { ...b1, json: { language: 'python', code: TWO_SUM_PY } });
    await check('badprofile@PORT', PORT, 'POST', '/api/questions/two-sum/skip', { ...b1, json: { language: 'python', code: '' } });
    await check('badprofile@PORT', PORT, 'PATCH', '/api/profile/preferred', { ...b1, json: { languages: ['python'] } });

    record('== A. a learner whose order.json is invalid ==');
    const b2 = { cookie: bq };
    await check('badqueue@PORT', PORT, 'GET', '/api/profile', b2);
    await check('badqueue@PORT', PORT, 'GET', '/api/next', b2);
    await check('badqueue@PORT', PORT, 'GET', '/api/queue', b2);
    await check('badqueue@PORT', PORT, 'POST', '/api/questions/two-sum/run', { ...b2, json: { language: 'python', code: TWO_SUM_PY } });
    await check('badqueue@PORT', PORT, 'POST', '/api/questions/two-sum/submit', { ...b2, json: { language: 'python', code: TWO_SUM_PY } });
    await check('badqueue@PORT', PORT, 'POST', '/api/questions/two-sum/skip', { ...b2, json: { language: 'python', code: '' } });

    const own = 'owner@TRUSTED';
    record('== A. the owner, on TRUSTED_PORT (no sign-in) ==');
    await check(own, TRUSTED, 'GET', '/api/auth/me');
    await check(own, TRUSTED, 'GET', '/api/auth/me', { cookie: bq });
    await check(own, TRUSTED, 'GET', '/api/profile');
    await check(own, TRUSTED, 'GET', '/api/next');
    await check(own, TRUSTED, 'GET', '/api/queue');
    await check(own, TRUSTED, 'POST', '/api/questions/two-sum/test', { json: { language: 'python', code: TWO_SUM_PY } });
    await check(own, TRUSTED, 'POST', '/api/questions/two-sum/test', { json: { language: 'python', code: WRONG_PY } });
    await check(own, TRUSTED, 'POST', '/api/questions/two-sum/test', { json: { language: 'python', code: '' } });
    await check(own, TRUSTED, 'POST', '/api/questions/nope/test', { json: { language: 'python', code: TWO_SUM_PY } });
    await check(own, TRUSTED, 'POST', '/api/questions/two-sum/test', { raw: 'x' });
    await check(own, TRUSTED, 'POST', '/api/questions/two-sum/submit', { json: { language: 'javascript', code: TWO_SUM_JS } });
    await check(own, TRUSTED, 'GET', '/api/submissions');
    await check(own, TRUSTED, 'GET', '/api/next');
    await check(own, TRUSTED, 'POST', '/api/auth/logout', { json: {} });
    await check(own, TRUSTED, 'GET', '/api/auth/me');
    for (const p of ['/', '/index.html', '/login.html', '/server.js', '/users/', '/nonexistent']) await check(own, TRUSTED, 'GET', p);

    record('== A. what the server logged while answering ==');
    for (const l of server.log.slice(startupLines)) record(`  log ${l}`);
    record('== A. users folder at the end ==');
    recordUsersDir(usersDir);
  } finally {
    await stopServer(server);
  }
}

/**
 * Phase B: no MAXRECALL_UNSANDBOXED, so where the sandbox doesn't work a
 * Run is refused with 503 (contract 2's 'SANDBOX_UNAVAILABLE').
 *
 * @param {string} tmp - The temporary folder.
 * @returns {Promise<void>} Once recorded.
 */
async function phaseB(tmp) {
  const usersDir = path.join(tmp, 'users-b');
  const authDir = path.join(tmp, 'auth-b');
  fs.mkdirSync(authDir, { recursive: true, mode: 0o700 });
  const PORT = await freePort();
  let TRUSTED = await freePort();
  while (TRUSTED === PORT) TRUSTED = await freePort();
  normalizers = new Map([[tmp, '<TMP>'], [`:${TRUSTED}`, ':<TRUSTED>'], [`:${PORT}`, ':<PORT>'], [` ${TRUSTED} `, ' <TRUSTED> '], [` ${PORT} `, ' <PORT> ']]);
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8',
    PORT: String(PORT), TRUSTED_PORT: String(TRUSTED),
    MAXRECALL_USER: OWNER, MAXRECALL_USERS_DIR: usersDir, MAXRECALL_AUTH_DIR: authDir,
  };
  const server = await startServer(env);
  try {
    const startupLines = await settle(server);
    record('== B. sandbox as found (no MAXRECALL_UNSANDBOXED): startup log ==');
    for (const l of server.log.slice(0, startupLines)) record(`  log ${l}`);
    await check('owner@TRUSTED', TRUSTED, 'POST', '/api/questions/two-sum/run', { json: { language: 'python', code: TWO_SUM_PY } });
    await check('owner@TRUSTED', TRUSTED, 'POST', '/api/questions/two-sum/submit', { json: { language: 'python', code: TWO_SUM_PY } });
    await check('owner@TRUSTED', TRUSTED, 'POST', '/api/questions/two-sum/test', { json: { language: 'python', code: TWO_SUM_PY } });
    record('== B. what the server logged while answering ==');
    for (const l of server.log.slice(startupLines)) record(`  log ${l}`);
  } finally {
    await stopServer(server);
  }
}

/**
 * Runs both phases and writes the output file.
 *
 * @returns {Promise<void>} Once written.
 */
async function main() {
  hashKnownFiles();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maxrecall-characterize-'));
  try {
    await phaseA(tmp);
    await phaseB(tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  fs.writeFileSync(OUT, `${lines.join('\n')}\n`);
  console.log(`${lines.length} lines written to ${OUT}`);
}

main().catch(
  /**
   * Prints what went wrong and exits with status 1.
   *
   * @param {Error} err - The error.
   * @returns {void}
   */
  (err) => {
    console.error(err);
    process.exit(1);
  },
);

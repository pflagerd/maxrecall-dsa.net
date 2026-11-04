'use strict';

// make invite EMAIL=… (docs/plans/limited-live.md, D2 and step 1): makes an
// invite code for one email and prints it, for the owner to send. EMAIL
// comes from the environment, as for make rename-question.
//
//   EMAIL=learner@example.com node scripts/invite.js
//
// The code works once, for that email only, until it expires (7 days). A
// new invite for the same email replaces the old one. On the VPS, run it as
// the service's user, with the service's folder:
//
//   sudo -u maxrecall env MAXRECALL_AUTH_DIR=/srv/maxrecall/data/auth make invite EMAIL=…
//
// The server needn't be stopped: it reads the invite when someone
// registers. Exits 0 when done, 1 when refused.

const fs = require('fs');
const path = require('path');

/**
 * Why the invite wasn't made, for the person running the command.
 */
class Refusal extends Error {}

/**
 * Refuses unless this process's user owns the sign-in data folder (if it
 * exists yet). Otherwise the invite file would belong to someone the server
 * may not be: on the VPS, root's file (mode 600) can't be read by the
 * maxrecall user, and registering would just say "isn't open". Works out
 * the folder as auth.js does, before loading auth.js, which would create
 * missing folders as this user.
 *
 * @returns {void}
 * @throws {Refusal} If the folder belongs to another user.
 */
function refuseIfNotOwner() {
  const dir = process.env.MAXRECALL_AUTH_DIR
    ? path.resolve(process.env.MAXRECALL_AUTH_DIR)
    : path.join(__dirname, '..', 'auth');
  let owner;
  try {
    owner = fs.statSync(dir).uid;
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return;
    throw err;
  }
  // process.getuid exists on every POSIX system; on Windows there's no
  // such check to make.
  if (process.getuid && process.getuid() !== owner) {
    throw new Refusal(`${dir} belongs to user id ${owner}, not you (${process.getuid()}). `
      + 'Run this as that user, so the server can read the invite. On the VPS: '
      + 'sudo -u maxrecall env MAXRECALL_AUTH_DIR=/srv/maxrecall/data/auth make invite EMAIL=…');
  }
}

/**
 * Makes the invite for $EMAIL and prints the code and how to use it.
 *
 * @returns {Promise<void>}
 * @throws {Refusal} If EMAIL is missing or not an email, or the folder
 *   belongs to another user.
 * @throws {Error} If the invite can't be written.
 */
async function main() {
  const rawEmail = process.env.EMAIL;
  if (!rawEmail) throw new Refusal('Say who to invite: make invite EMAIL=learner@example.com');
  refuseIfNotOwner();
  const { createInvite, INVITES_DIR, MIN_PASSWORD_LENGTH } = require('../auth');
  let invite;
  try {
    invite = await createInvite(rawEmail);
  } catch (err) {
    if (/Not an email address/.test(/** @type {Error} */ (err).message)) throw new Refusal(/** @type {Error} */ (err).message);
    throw err;
  }
  console.log(`Invite for ${invite.email}, saved in ${path.join(INVITES_DIR, `${invite.email}.json`)}.`);
  console.log(`Code (shown only now): ${invite.code}`);
  console.log(`It works once, until ${invite.expiresAt} (UTC). Any earlier invite for this email no longer works.`);
  console.log(`They register on the login page's Register form (login.html#register) with this email, the code,`);
  console.log(`and a password of their own, at least ${MIN_PASSWORD_LENGTH} characters.`);
}

main().catch(
  /**
   * Explains a refusal and exits 1; anything else is unexpected and shown
   * in full.
   *
   * @param {Error} err - Why main() failed.
   * @returns {void}
   */
  (err) => {
    console.error(err instanceof Refusal ? `Refused: ${err.message}` : err);
    process.exitCode = 1;
  },
);

'use strict';

// Tests for profile.js (docs/plans/spaced-repetition.md, D2). Run with
// `make test`.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { LANGUAGES, effectiveProfile, parseProfile, applyPreferredChange } = require('./profile');

const EVERYTHING = {
  allowedLanguages: ['javascript', 'python', 'cpp', 'java', 'd'],
  languages: ['javascript', 'python', 'cpp', 'java', 'd'],
  defaultLanguage: 'javascript',
  canChooseLanguages: true,
  canSwitchLanguage: true,
  canSetDefaultLanguage: true,
};

/**
 * Asserts that fn throws an error with this code (and message, if given).
 *
 * @param {() => unknown} fn - The call expected to throw.
 * @param {string} code - The error's expected code.
 * @param {RegExp} [message] - A pattern the message must match.
 * @returns {void}
 */
function throwsCode(fn, code, message) {
  assert.throws(
    fn,
    /**
     * Checks the error's code (and message).
     *
     * @param {any} err - What fn threw.
     * @returns {boolean} true, as assert.throws expects once the checks pass.
     */
    (err) => {
      assert.equal(err.code, code);
      if (message) assert.match(err.message, message);
      return true;
    },
  );
}

test('LANGUAGES is the judge\'s five, in menu order', () => {
  assert.deepEqual(LANGUAGES, ['javascript', 'python', 'cpp', 'java', 'd']);
});

/** [what it checks, profile.json's contents, the effective profile expected]. @type {[string, unknown, object][]} */
const VALID = [
  ['no file means everything allowed', undefined, EVERYTHING],
  ['a file with only schemaVersion means the same', { schemaVersion: 1 }, EVERYTHING],
  ['allowed languages restrict, in their order', { schemaVersion: 1, allowed: { languages: ['cpp', 'python'] } },
    { ...EVERYTHING, allowedLanguages: ['cpp', 'python'], languages: ['cpp', 'python'], defaultLanguage: 'cpp' }],
  ['preferred languages pick and order within allowed (decision 2)',
    { schemaVersion: 1, allowed: { languages: ['python', 'cpp', 'java'] }, preferred: { languages: ['java', 'python'] } },
    { ...EVERYTHING, allowedLanguages: ['python', 'cpp', 'java'], languages: ['java', 'python'], defaultLanguage: 'java' }],
  ['a preferred language allowed no longer has is skipped, not an error (D2)',
    { schemaVersion: 1, allowed: { languages: ['python'] }, preferred: { languages: ['cpp', 'python'], defaultLanguage: 'cpp' } },
    { ...EVERYTHING, allowedLanguages: ['python'], languages: ['python'], defaultLanguage: 'python' }],
  ['if none of the preferred languages is allowed, all allowed ones are on',
    { schemaVersion: 1, allowed: { languages: ['python', 'd'] }, preferred: { languages: ['cpp'] } },
    { ...EVERYTHING, allowedLanguages: ['python', 'd'], languages: ['python', 'd'], defaultLanguage: 'python' }],
  ['the default language is used when it is on', { schemaVersion: 1, preferred: { defaultLanguage: 'd' } },
    { ...EVERYTHING, defaultLanguage: 'd' }],
  ['a default language that is turned off falls back to the first on',
    { schemaVersion: 1, preferred: { languages: ['java', 'cpp'], defaultLanguage: 'python' } },
    { ...EVERYTHING, languages: ['java', 'cpp'], defaultLanguage: 'java' }],
  ['the allowed flags are honoured', { schemaVersion: 1, allowed: { canChooseLanguages: false, canSwitchLanguage: false, canSetDefaultLanguage: false } },
    { ...EVERYTHING, canChooseLanguages: false, canSwitchLanguage: false, canSetDefaultLanguage: false }],
];

for (const [what, raw, expected] of VALID) {
  test(what, () => {
    assert.deepEqual(effectiveProfile(raw), expected);
  });
}

/** [what is wrong, profile.json's contents, a pattern the message must match]. @type {[string, unknown, RegExp][]} */
const INVALID = [
  ['a list, not an object', [], /JSON object/],
  ['null', null, /JSON object/],
  ['no schemaVersion', { allowed: { languages: ['python'] } }, /schemaVersion/],
  ['a schemaVersion this code does not know', { schemaVersion: 2 }, /schemaVersion/],
  ['a misspelt top-level field (fails closed rather than allowing everything)', { schemaVersion: 1, allowd: { languages: ['python'] } }, /"allowd"/],
  ['a misspelt field inside allowed', { schemaVersion: 1, allowed: { langauges: ['python'] } }, /"allowed\.langauges"/],
  ['a misspelt field inside preferred', { schemaVersion: 1, preferred: { default: 'python' } }, /"preferred\.default"/],
  ['allowed is not an object', { schemaVersion: 1, allowed: ['python'] }, /allowed must be an object/],
  ['no allowed languages', { schemaVersion: 1, allowed: { languages: [] } }, /allowed\.languages/],
  ['a language the judge does not know', { schemaVersion: 1, allowed: { languages: ['python', 'cobol'] } }, /"cobol"/],
  ['a language listed twice', { schemaVersion: 1, allowed: { languages: ['python', 'python'] } }, /twice/],
  ['a flag that is not true or false', { schemaVersion: 1, allowed: { canSwitchLanguage: 'yes' } }, /canSwitchLanguage/],
  ['an unknown preferred language', { schemaVersion: 1, preferred: { languages: ['Python'] } }, /preferred\.languages/],
  ['an unknown default language', { schemaVersion: 1, preferred: { defaultLanguage: 'cobol' } }, /defaultLanguage/],
];

for (const [what, raw, message] of INVALID) {
  test(`invalid, refused naming the field: ${what}`, () => {
    throwsCode(() => effectiveProfile(raw), 'INVALID_PROFILE', message);
  });
}

test('parseProfile: no file, valid text, and text that is not JSON', () => {
  assert.deepEqual(parseProfile(undefined), EVERYTHING);
  assert.deepEqual(parseProfile('{"schemaVersion": 1, "allowed": {"languages": ["d"]}}').languages, ['d']);
  throwsCode(() => parseProfile('{"schemaVersion": 1,'), 'INVALID_PROFILE', /not valid JSON/);
});

test('a change with no file yet makes a new file holding only preferred', () => {
  assert.deepEqual(applyPreferredChange(undefined, { languages: ['python', 'cpp'], defaultLanguage: 'cpp' }), {
    schemaVersion: 1,
    preferred: { languages: ['python', 'cpp'], defaultLanguage: 'cpp' },
  });
});

test('a change leaves allowed exactly as it was, and does not alter what it was given', () => {
  const raw = { schemaVersion: 1, allowed: { languages: ['python', 'java'], canSwitchLanguage: false }, preferred: { defaultLanguage: 'java' } };
  const before = JSON.stringify(raw);
  const after = applyPreferredChange(raw, { languages: ['java'] });
  assert.deepEqual(after.allowed, raw.allowed);
  assert.deepEqual(after.preferred, { defaultLanguage: 'java', languages: ['java'] });
  assert.equal(JSON.stringify(raw), before);
});

/** [what is refused, profile.json now, the change, the expected code]. @type {[string, unknown, any, string][]} */
const REFUSED = [
  ['turning languages on and off when canChooseLanguages is false',
    { schemaVersion: 1, allowed: { canChooseLanguages: false } }, { languages: ['python'] }, 'NOT_PERMITTED'],
  ['setting the default when canSetDefaultLanguage is false',
    { schemaVersion: 1, allowed: { canSetDefaultLanguage: false } }, { defaultLanguage: 'python' }, 'NOT_PERMITTED'],
  ['a language that is not allowed', { schemaVersion: 1, allowed: { languages: ['python'] } }, { languages: ['python', 'cpp'] }, 'INVALID_CHANGE'],
  ['no languages at all', undefined, { languages: [] }, 'INVALID_CHANGE'],
  ['a language twice', undefined, { languages: ['d', 'd'] }, 'INVALID_CHANGE'],
  ['a default that is turned off', { schemaVersion: 1, preferred: { languages: ['java'] } }, { defaultLanguage: 'python' }, 'INVALID_CHANGE'],
  ['a default turned off by the same change', undefined, { languages: ['java'], defaultLanguage: 'python' }, 'INVALID_CHANGE'],
  ['a default that only a stale preferred list still names',
    { schemaVersion: 1, allowed: { languages: ['python'] }, preferred: { languages: ['cpp', 'python'] } }, { defaultLanguage: 'cpp' }, 'INVALID_CHANGE'],
  ['a field other than languages and defaultLanguage', undefined, { allowed: { languages: ['d'] } }, 'INVALID_CHANGE'],
  ['an empty change', undefined, {}, 'INVALID_CHANGE'],
  ['when the file itself is invalid', { schemaVersion: 1, allowd: {} }, { defaultLanguage: 'python' }, 'INVALID_PROFILE'],
];

for (const [what, raw, change, code] of REFUSED) {
  test(`change refused (${code}): ${what}`, () => {
    throwsCode(() => applyPreferredChange(raw, change), code);
  });
}

test('both changed at once: the default may be one of the newly chosen languages', () => {
  const after = applyPreferredChange(undefined, { languages: ['d', 'java'], defaultLanguage: 'java' });
  const profile = effectiveProfile(after);
  assert.deepEqual(profile.languages, ['d', 'java']);
  assert.equal(profile.defaultLanguage, 'java');
});

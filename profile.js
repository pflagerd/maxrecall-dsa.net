'use strict';

// A learner's profile, users/<email>/profile.json: which languages they may
// use, and their own choices among them. docs/plans/spaced-repetition.md,
// decision D2 (the layout and its five details were decided 2026-11-03).
//
//   {
//     "schemaVersion": 1,
//     "allowed":   { "languages": [...], "canChooseLanguages": true,
//                    "canSwitchLanguage": true, "canSetDefaultLanguage": true },
//     "preferred": { "languages": [...], "defaultLanguage": "python" }
//   }
//
// `allowed` is set by the owner or a teacher, never by the learner;
// `preferred` is the learner's, within `allowed`. Every field is optional,
// and no file at all means everything is allowed. The rest of the code uses
// only the *effective* profile worked out here, never the file itself.
//
// Invalid files fail closed (decision 4): this is about who may use what, so
// a mistake must refuse rather than quietly allow everything. That includes
// unknown field names, so a typo like "allowd" can't drop the restriction.
//
// Pure functions only: reading and writing the file is the server's job.

/** The five languages the judge knows, in the order menus show them. @type {readonly string[]} */
const LANGUAGES = Object.freeze(['javascript', 'python', 'cpp', 'java', 'd']);
/** The profile.json format this file reads and writes. @type {number} */
const SCHEMA_VERSION = 1;

const ALLOWED_FLAGS = ['canChooseLanguages', 'canSwitchLanguage', 'canSetDefaultLanguage'];

/**
 * profile.json as written (every field optional except schemaVersion).
 *
 * @typedef {object} ProfileFile
 * @property {number} schemaVersion - SCHEMA_VERSION.
 * @property {{ languages?: string[], canChooseLanguages?: boolean, canSwitchLanguage?: boolean, canSetDefaultLanguage?: boolean }} [allowed]
 *   What the learner may do: set by the owner or a teacher.
 * @property {{ languages?: string[], defaultLanguage?: string }} [preferred]
 *   The learner's own choices, within allowed.
 */

/**
 * The profile as the rest of the code sees it: every value worked out.
 *
 * @typedef {object} EffectiveProfile
 * @property {string[]} allowedLanguages - Languages the learner may use at
 *   all; the server refuses the others (403).
 * @property {string[]} languages - The allowed languages the learner has
 *   turned on, in their order: the ones in the queue (decision 1), in the
 *   order new pairs come in (decision 2). Never empty.
 * @property {string} defaultLanguage - One of languages.
 * @property {boolean} canChooseLanguages - May they turn languages on and off?
 * @property {boolean} canSwitchLanguage - May they change a question's
 *   language themselves? (Next still goes wherever the queue says, decision 3.)
 * @property {boolean} canSetDefaultLanguage - May they set their default language?
 */

/**
 * Why a profile.json can't be used. The server refuses Run and Submit with
 * its message rather than guess (decision 4).
 */
class ProfileError extends Error {
  /** @param {string} message - What's wrong, naming the field. */
  constructor(message) {
    super(`profile.json: ${message}`);
    this.code = 'INVALID_PROFILE';
  }
}

/**
 * Why a change to preferred was refused: code NOT_PERMITTED (an allowed
 * flag forbids it: 403) or INVALID_CHANGE (it doesn't fit allowed: 400).
 */
class ProfileChangeError extends Error {
  /**
   * @param {'NOT_PERMITTED' | 'INVALID_CHANGE'} code - Which kind of refusal.
   * @param {string} message - Why.
   */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Whether value is a plain object (not null, not an array).
 *
 * @param {unknown} value - The value.
 * @returns {value is Record<string, unknown>} True for a plain object.
 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Throws if an object has a field this format doesn't know.
 *
 * @param {Record<string, unknown>} object - The object.
 * @param {string[]} known - Its field names.
 * @param {string} where - Where it is, for the message ("" for the top level).
 * @returns {void}
 * @throws {ProfileError} Naming the first unknown field.
 */
function rejectUnknownFields(object, known, where) {
  const unknown = Object.keys(object).find((key) => !known.includes(key));
  if (unknown !== undefined) throw new ProfileError(`unknown field "${where}${unknown}"`);
}

/**
 * Checks a list of languages: known names, at least one, none twice.
 *
 * @param {unknown} value - The list, from the file.
 * @param {string} where - Its field, for the message.
 * @returns {string[]} The list.
 * @throws {ProfileError} If it isn't such a list.
 */
function checkLanguageList(value, where) {
  if (!Array.isArray(value) || value.length === 0) throw new ProfileError(`${where} must be a list of at least one language`);
  for (const language of value) {
    if (!LANGUAGES.includes(language)) throw new ProfileError(`${where} has ${JSON.stringify(language)}, which isn't one of ${LANGUAGES.join(', ')}`);
  }
  if (new Set(value).size !== value.length) throw new ProfileError(`${where} lists a language twice`);
  return value;
}

/**
 * Works out the effective profile from profile.json's contents.
 *
 * - No file (undefined): all five languages, everything allowed.
 * - preferred.languages are kept only where allowed, so a language taken
 *   away from allowed is skipped, not an error (D2); if none is left, all
 *   allowed languages are on.
 * - A defaultLanguage that isn't on falls back to the first one that is.
 *
 * @param {unknown} raw - The parsed file, or undefined if there's none.
 * @returns {EffectiveProfile} The profile to use.
 * @throws {ProfileError} If the file isn't a valid profile (fail closed).
 */
function effectiveProfile(raw) {
  if (raw === undefined) raw = { schemaVersion: SCHEMA_VERSION };
  if (!isPlainObject(raw)) throw new ProfileError('must be a JSON object');
  rejectUnknownFields(raw, ['schemaVersion', 'allowed', 'preferred'], '');
  if (raw.schemaVersion !== SCHEMA_VERSION) throw new ProfileError(`schemaVersion must be ${SCHEMA_VERSION}`);

  const allowed = raw.allowed === undefined ? {} : raw.allowed;
  if (!isPlainObject(allowed)) throw new ProfileError('allowed must be an object');
  rejectUnknownFields(allowed, ['languages', ...ALLOWED_FLAGS], 'allowed.');
  const allowedLanguages = allowed.languages === undefined ? [...LANGUAGES] : checkLanguageList(allowed.languages, 'allowed.languages');
  /** @type {Record<string, boolean>} */
  const flags = {};
  for (const flag of ALLOWED_FLAGS) {
    const value = allowed[flag] === undefined ? true : allowed[flag];
    if (typeof value !== 'boolean') throw new ProfileError(`allowed.${flag} must be true or false`);
    flags[flag] = value;
  }

  const preferred = raw.preferred === undefined ? {} : raw.preferred;
  if (!isPlainObject(preferred)) throw new ProfileError('preferred must be an object');
  rejectUnknownFields(preferred, ['languages', 'defaultLanguage'], 'preferred.');
  const chosen = preferred.languages === undefined ? [] : checkLanguageList(preferred.languages, 'preferred.languages');
  const kept = chosen.filter((language) => allowedLanguages.includes(language));
  const languages = kept.length ? kept : allowedLanguages;
  if (preferred.defaultLanguage !== undefined && !LANGUAGES.includes(/** @type {string} */ (preferred.defaultLanguage))) {
    throw new ProfileError(`preferred.defaultLanguage must be one of ${LANGUAGES.join(', ')}`);
  }
  const defaultLanguage = languages.includes(/** @type {string} */ (preferred.defaultLanguage))
    ? /** @type {string} */ (preferred.defaultLanguage)
    : languages[0];

  return {
    allowedLanguages,
    languages,
    defaultLanguage,
    canChooseLanguages: flags.canChooseLanguages,
    canSwitchLanguage: flags.canSwitchLanguage,
    canSetDefaultLanguage: flags.canSetDefaultLanguage,
  };
}

/**
 * Works out the effective profile from profile.json's text.
 *
 * @param {string | undefined} text - The file's contents, or undefined if
 *   there's no file.
 * @returns {EffectiveProfile} The profile to use.
 * @throws {ProfileError} If it isn't valid JSON, or not a valid profile.
 */
function parseProfile(text) {
  if (text === undefined) return effectiveProfile(undefined);
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new ProfileError(`not valid JSON (${/** @type {Error} */ (err).message})`);
  }
  return effectiveProfile(raw);
}

/**
 * The file's new contents after the learner changes their own choices
 * (PATCH /api/profile/preferred, decision 5). Only preferred changes;
 * allowed is copied as it was. The result is checked as a whole, so it is
 * always a valid profile.
 *
 * @param {unknown} raw - The parsed file now, or undefined if there's none
 *   (a new file is then made).
 * @param {{ languages?: unknown, defaultLanguage?: unknown }} change - What
 *   to change: either or both, from the request.
 * @returns {ProfileFile} The new contents, to write.
 * @throws {ProfileError} If the file as it is now is invalid.
 * @throws {ProfileChangeError} NOT_PERMITTED if an allowed flag forbids the
 *   change; INVALID_CHANGE if it isn't allowed languages, isn't a turned-on
 *   language, or has fields other than languages and defaultLanguage.
 */
function applyPreferredChange(raw, change) {
  const current = effectiveProfile(raw);
  if (!isPlainObject(change) || Object.keys(change).length === 0) {
    throw new ProfileChangeError('INVALID_CHANGE', 'Send languages, defaultLanguage, or both.');
  }
  const extra = Object.keys(change).find((key) => key !== 'languages' && key !== 'defaultLanguage');
  if (extra !== undefined) throw new ProfileChangeError('INVALID_CHANGE', `Only languages and defaultLanguage can be changed, not "${extra}".`);

  const file = /** @type {ProfileFile} */ (raw === undefined ? { schemaVersion: SCHEMA_VERSION } : JSON.parse(JSON.stringify(raw)));
  const preferred = { ...(file.preferred || {}) };

  if (change.languages !== undefined) {
    if (!current.canChooseLanguages) throw new ProfileChangeError('NOT_PERMITTED', 'Choosing languages is turned off for you.');
    const list = change.languages;
    if (!Array.isArray(list) || list.length === 0 || new Set(list).size !== list.length
      || !list.every((language) => current.allowedLanguages.includes(language))) {
      throw new ProfileChangeError('INVALID_CHANGE', `languages must be at least one of ${current.allowedLanguages.join(', ')}, none twice.`);
    }
    preferred.languages = list;
  }
  if (change.defaultLanguage !== undefined) {
    if (!current.canSetDefaultLanguage) throw new ProfileChangeError('NOT_PERMITTED', 'Setting your default language is turned off for you.');
    // The languages that will be on after this change, as effectiveProfile
    // works them out: not preferred.languages itself, which can still name
    // a language allowed no longer has.
    const on = effectiveProfile({ ...file, preferred }).languages;
    if (typeof change.defaultLanguage !== 'string' || !on.includes(change.defaultLanguage)) {
      throw new ProfileChangeError('INVALID_CHANGE', `defaultLanguage must be one of ${on.join(', ')}.`);
    }
    preferred.defaultLanguage = change.defaultLanguage;
  }

  file.preferred = preferred;
  effectiveProfile(file); // the whole new file must be valid
  return file;
}

module.exports = { LANGUAGES, SCHEMA_VERSION, ProfileError, ProfileChangeError, effectiveProfile, parseProfile, applyPreferredChange };

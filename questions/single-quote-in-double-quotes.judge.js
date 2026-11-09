'use strict';

// The judge for "A Single Quote Inside Double Quotes" (#160, step 5). It
// reads the blank's text and never runs the program: the output can't tell
// ' from \', which print the same (run on Python 3.13.18), but the text
// can. The messages say what Python would do with each wrong answer; each
// was checked by running the template with that blank in it (#160, B1).
//
// Server code (docs/roles/questions.md, "Judge files"): it keeps R1 (only
// its own names, called built-ins, no property writes), and it's quick
// (Q7): a few comparisons on at most 10 characters.

/**
 * Judges one answer: whether the blank holds a single quote, written as it
 * is, with no backslash. The question is in Python only, so the language
 * it's answered in isn't needed.
 *
 * @param {string} blank - What the learner typed in the blank, at most 10
 *   characters (the route checks that first, contract 2).
 * @returns {{ pass: boolean, message?: string }} The verdict, and for a
 *   fail, what went wrong, as text.
 */
function judge(blank) {
  if (blank === "'") return { pass: true };
  if (blank === "\\'") return { pass: false, message: 'Your answer would technically work, but is not what we asked for. Inside a double-quoted string, a single quote needs no backslash.' };
  if (blank === '‘' || blank === '’') return { pass: false, message: "That's a curly quote (‘ or ’), which phones and some keyboards type in place of the straight one. Python prints it, but it isn't a single quote. Type the straight ' instead. On a phone, a smart-punctuation setting may be changing it." };
  if (blank === '"\'"') return { pass: false, message: 'The first " would end the string the sentence is in. Type only the quote itself.' };
  if (blank === "''") return { pass: false, message: "That's two quotes. The sentence asks for one." };
  if (blank === '"') return { pass: false, message: "That's a double quote. It would end the string." };
  if (blank === '') return { pass: false, message: 'Type the single quote.' };
  if (blank.trim() === "'") return { pass: false, message: 'Just the quote, with no spaces: Python would print the spaces too.' };
  return { pass: false, message: "Not a single quote. Type the ' character." };
}

module.exports = {
  judge,
  // This judge's own cases (#160, Q6b.3): questions.test.js runs each in a
  // worker thread, stopped if it takes over 1 s (#172).
  cases: [
    { blank: "'", pass: true },
    { blank: "\\'", pass: false, messageIncludes: 'technically work' },
    { blank: '‘', pass: false, messageIncludes: 'curly quote' },
    { blank: '’', pass: false, messageIncludes: 'curly quote' },
    { blank: '"\'"', pass: false, messageIncludes: 'would end the string the sentence is in' },
    { blank: "''", pass: false, messageIncludes: 'two quotes' },
    { blank: '"', pass: false, messageIncludes: 'double quote' },
    { blank: '', pass: false, messageIncludes: 'Type the single quote' },
    { blank: " ' ", pass: false, messageIncludes: 'no spaces' },
    { blank: "'  ", pass: false, messageIncludes: 'no spaces' },
    { blank: 'x', pass: false, messageIncludes: 'Not a single quote' },
    { blank: '`', pass: false, messageIncludes: 'Not a single quote' },
  ],
};

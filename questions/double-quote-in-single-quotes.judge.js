'use strict';

// The judge for "A Double Quote Inside Single Quotes" (Issue 244). The
// template is print('You can put a double quote like ___ in a single
// quoted string without a leading backslash.'), and the blank takes at
// most 2 characters. It reads the blank's text and never runs the program.
//
// The owner's rule for this question (2026-11-10): the judge fails no
// answer Python would accept, read as: it passes every answer that makes
// the program print the sentence with exactly one " where the blank is.
// Every answer of up to 2 printable ASCII characters was run in the
// template (Python 3.13.18): two print exactly that, " and \" (the
// backslash escape). Both pass here, and nothing else does.
//
// Server code (docs/roles/questions.md, "Judge files"): it keeps R1 (only
// its own names, called built-ins, no property writes), and it's quick
// (Q7): a few comparisons on at most 2 characters.

/**
 * Judges one answer: whether the blank makes the program print a double
 * quote there, which a " does, with or without a backslash before it. The
 * question is in Python only, so the language it's answered in isn't
 * needed.
 *
 * @param {string} blank - What the learner typed in the blank, at most 2
 *   characters, the question's maxLength (the route checks that first,
 *   contract 2).
 * @returns {{ pass: boolean, message?: string }} The verdict; for a fail,
 *   what went wrong, and for a pass with a backslash, that it isn't
 *   needed, as text.
 */
function judge(blank) {
  if (blank === '"') return { pass: true };
  if (blank === '\\"') return { pass: true, message: 'That works. Inside single quotes a " needs no backslash, so " alone is enough.' };
  if (blank === "'") return { pass: false, message: 'That\'s a single quote. It would end the string: Python would report "SyntaxError: unterminated string literal".' };
  if (blank === '""') return { pass: false, message: "That's two quotes. The sentence asks for one." };
  if (blank === '“' || blank === '”') return { pass: false, message: 'That\'s a curly quote (“ or ”), which phones and some keyboards type in place of the straight one. Python prints it, but it isn\'t a double quote. Type the straight " instead. On a phone, a smart-punctuation setting may be changing it.' };
  if (blank === '') return { pass: false, message: 'Type the double quote.' };
  if (blank.trim() === '"') return { pass: false, message: 'Just the quote, with no spaces: Python would print the space too.' };
  return { pass: false, message: 'Not a double quote. Type the " character.' };
}

module.exports = {
  judge,
  // This judge's own cases (#160, Q6b.3): questions.test.js runs each in a
  // worker thread, stopped if it takes over 1 s (#172).
  cases: [
    { blank: '"', pass: true },
    { blank: '\\"', pass: true, messageIncludes: 'needs no backslash' },
    { blank: "'", pass: false, messageIncludes: 'single quote' },
    { blank: '""', pass: false, messageIncludes: 'two quotes' },
    { blank: '“', pass: false, messageIncludes: 'curly quote' },
    { blank: '”', pass: false, messageIncludes: 'curly quote' },
    { blank: '', pass: false, messageIncludes: 'Type the double quote' },
    { blank: ' "', pass: false, messageIncludes: 'no spaces' },
    { blank: '" ', pass: false, messageIncludes: 'no spaces' },
    { blank: "\\'", pass: false, messageIncludes: 'Not a double quote' },
    { blank: "''", pass: false, messageIncludes: 'Not a double quote' },
    { blank: 'x', pass: false, messageIncludes: 'Not a double quote' },
    { blank: '`', pass: false, messageIncludes: 'Not a double quote' },
  ],
};

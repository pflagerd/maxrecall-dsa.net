'use strict';

// The judge for "Single Quotes Make a String Too". The template is
// print('Hello World!___): the string starts with a single quote, and the
// blank is the quote that ends it. It reads the blank's text and never
// runs the program. The messages say what Python would do with each wrong
// answer; each was checked by running the template with that blank in it
// (Python 3.13.18, 2026-11-10).
//
// Server code (docs/roles/questions.md, "Judge files"): it keeps R1 (only
// its own names, called built-ins, no property writes), and it's quick
// (Q7): a few comparisons on at most 3 characters.

/**
 * Judges one answer: whether the blank holds a single quote and nothing
 * else, which ends the string the template starts. The question is in
 * Python only, so the language it's answered in isn't needed.
 *
 * @param {string} blank - What the learner typed in the blank, at most 3
 *   characters, the question's maxLength (the route checks that first,
 *   contract 2).
 * @returns {{ pass: boolean, message?: string }} The verdict, and for a
 *   fail, what went wrong, as text.
 */
function judge(blank) {
  if (blank === "'") return { pass: true };
  if (blank === '"') return { pass: false, message: "The string starts with ' so it must end with ' too. A \" doesn't end it: Python would report \"SyntaxError: unterminated string literal\"." };
  if (blank === '‘' || blank === '’') return { pass: false, message: "That's a curly quote (‘ or ’), which phones and some keyboards type in place of the straight one. It doesn't end the string: Python would report \"SyntaxError: unterminated string literal\". Type the straight ' instead. On a phone, a smart-punctuation setting may be changing it." };
  if (blank === "\\'") return { pass: false, message: "A backslash before the quote makes the quote part of the string, not its end, so the string never ends: Python would report \"SyntaxError: unterminated string literal\"." };
  if (blank === "''") return { pass: false, message: "That's two quotes. The first ends the string, and the second starts another that never ends: Python would report \"SyntaxError: unterminated string literal\"." };
  if (blank === "'''") return { pass: false, message: "That's three quotes. Python would happen to accept it, but one quote is all it takes to end the string." };
  if (blank === "')") return { pass: false, message: "The ) is already there, after the blank, so Python would report \"SyntaxError: unmatched ')'\". Type only the quote." };
  if (blank === '"\'') return { pass: false, message: 'The " comes before the quote that ends the string, so it would be part of the string: Python would print Hello World!" with the " at the end. Type only the quote that ends it.' };
  if (blank === '') return { pass: false, message: 'Type the quote that ends the string.' };
  if (blank.trim() === "'") return { pass: false, message: 'Just the quote, with no spaces.' };
  // With no ' at all, nothing ends the string, whatever else was typed.
  // With one, what Python does depends on the rest ('*2 prints the text
  // twice, 'x is a syntax error), so that message makes no claim about it.
  if (!blank.includes("'")) return { pass: false, message: 'That doesn\'t end the string: Python would report "SyntaxError: unterminated string literal". A string ends with the same kind of quote it starts with.' };
  return { pass: false, message: 'Type only the quote that ends the string, and nothing else.' };
}

module.exports = {
  judge,
  // This judge's own cases (#160, Q6b.3): questions.test.js runs each in a
  // worker thread, stopped if it takes over 1 s (#172).
  cases: [
    { blank: "'", pass: true },
    { blank: '"', pass: false, messageIncludes: 'must end with' },
    { blank: '‘', pass: false, messageIncludes: 'curly quote' },
    { blank: '’', pass: false, messageIncludes: 'curly quote' },
    { blank: "\\'", pass: false, messageIncludes: 'backslash' },
    { blank: "''", pass: false, messageIncludes: 'two quotes' },
    { blank: "'''", pass: false, messageIncludes: 'three quotes' },
    { blank: "')", pass: false, messageIncludes: 'already there' },
    { blank: '"\'', pass: false, messageIncludes: 'part of the string' },
    { blank: '', pass: false, messageIncludes: 'Type the quote' },
    { blank: " '", pass: false, messageIncludes: 'no spaces' },
    { blank: "' ", pass: false, messageIncludes: 'no spaces' },
    { blank: 'x', pass: false, messageIncludes: 'same kind of quote' },
    { blank: '`', pass: false, messageIncludes: 'same kind of quote' },
    { blank: "'x", pass: false, messageIncludes: 'nothing else' },
    { blank: "'*2", pass: false, messageIncludes: 'nothing else' },
    { blank: "',1", pass: false, messageIncludes: 'nothing else' },
  ],
};

#!/usr/bin/env node
'use strict';

// make doc-check: checks every documented JavaScript file (those
// tsconfig.json and tsconfig.browser.json take in, by name or by pattern,
// as TypeScript reads them) for the documentation standard
// in CLAUDE.md: every function has a JSDoc block documenting its signature,
// meaning a @param for each parameter and a @returns (constructors and
// setters excepted). make typecheck checks that the types written are
// right; this checks that they're written at all.
//
// Not checked, as the owner decided (CLAUDE.md, 2026-11-03):
//   - a single-expression arrow, e.g. (tc) => !tc.hidden;
//   - an empty no-op, e.g. .catch(() => {});
//   - a test body, a function passed straight to test(...) in a *.test.js
//     file: the test's name is its documentation.
//
// It uses TypeScript's own parser, through TypeScript 6.0.3's JavaScript
// API (installed as the development dependency "typescript6"): TypeScript
// 7's package, used by make typecheck, doesn't provide one.
//
// Exits 1, listing each problem as file:line, if there are any.

const fs = require('fs');
const path = require('path');
const ts = require('typescript6');

const REPO_DIR = path.join(__dirname, '..');
const CONFIGS = ['tsconfig.json', 'tsconfig.browser.json'];

/**
 * The JavaScript files the two tsconfig files take in, read by
 * TypeScript itself, so the list is exactly make typecheck's: their
 * "files", and anything their "include" patterns match (since #160,
 * tsconfig.json's questions/*.judge.js).
 *
 * @returns {string[]} Their paths, relative to the repository.
 * @throws {Error} If a tsconfig file can't be read or parsed: checking
 *   fewer files than make typecheck does would pass silently.
 */
function documentedFiles() {
  const files = new Set();
  for (const config of CONFIGS) {
    const configPath = path.join(REPO_DIR, config);
    const { config: json, error } = ts.readConfigFile(configPath, ts.sys.readFile);
    if (error) throw new Error(`${config}: ${ts.flattenDiagnosticMessageText(error.messageText, ' ')}`);
    const parsed = ts.parseJsonConfigFileContent(json, ts.sys, REPO_DIR, undefined, configPath);
    if (parsed.errors.length) {
      throw new Error(`${config}: ${parsed.errors.map((e) => ts.flattenDiagnosticMessageText(e.messageText, ' ')).join('; ')}`);
    }
    for (const file of parsed.fileNames) if (file.endsWith('.js')) files.add(path.relative(REPO_DIR, file));
  }
  return [...files].sort();
}

/**
 * Whether a function is one the standard exempts.
 *
 * @param {ts.SignatureDeclaration} fn - The function.
 * @param {string} file - Its file, relative to the repository.
 * @returns {boolean} True for a single-expression arrow, an empty no-op,
 *   or a test body.
 */
function isExempt(fn, file) {
  if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) return true;
  const body = /** @type {ts.FunctionLikeDeclaration} */ (fn).body;
  if ((ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && body && ts.isBlock(body) && body.statements.length === 0) return true;
  const call = fn.parent;
  return file.endsWith('.test.js') && ts.isCallExpression(call) && ts.isIdentifier(call.expression) && call.expression.text === 'test';
}

/**
 * What a function's JSDoc block documents.
 *
 * @typedef {{ params: { name: string | null }[], hasReturns: boolean }} BlockTags
 */

/**
 * Finds a function's JSDoc block and reads its tags. The block is either
 * attached to the function (on itself, including one written directly
 * before it inside a call, or on what it's assigned to: const f = () =>
 * {...}, an object's property), or before what wraps it: the parentheses of
 * an immediately invoked function (a block, then (function f() {...})();),
 * and that call's statement. TypeScript attaches the second kind to the
 * parentheses, not the function, so its tags are read here: the block's
 * text is parsed again in front of an empty function, and that function's
 * tags read with the same public calls as the first kind.
 *
 * @param {ts.SignatureDeclaration} fn - The function.
 * @param {string} text - Its file's text.
 * @returns {BlockTags | null} The param tags, in order, and whether there's
 *   a returns tag; null if there's no block.
 */
function blockTags(fn, text) {
  if (ts.getJSDocCommentsAndTags(fn).length > 0) {
    return {
      params: fn.parameters.map((param) => ({ name: ts.getJSDocParameterTags(param).length ? (ts.isIdentifier(param.name) ? param.name.text : '') : null })),
      hasReturns: Boolean(ts.getJSDocReturnTag(fn)),
    };
  }
  /** @type {ts.Node} */
  let node = fn;
  for (;;) {
    const range = (ts.getLeadingCommentRanges(text, node.getFullStart()) || []).find((r) => text.startsWith('/**', r.pos));
    if (range) {
      const alone = ts.createSourceFile('block.js', `${text.slice(range.pos, range.end)}\nfunction f() {}`, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
      const tags = ts.getJSDocTags(alone.statements[0]);
      return {
        params: tags.filter(ts.isJSDocParameterTag).map((tag) => ({ name: ts.isIdentifier(tag.name) ? String(tag.name.escapedText) : '' })),
        hasReturns: tags.some(ts.isJSDocReturnTag),
      };
    }
    const parent = node.parent;
    const wraps = ts.isParenthesizedExpression(parent)
      || (ts.isCallExpression(parent) && parent.expression === node)
      || (ts.isExpressionStatement(parent) && parent.expression === node);
    if (!wraps) return null;
    node = parent;
  }
}

/**
 * A short name for a function, for the report.
 *
 * @param {ts.SignatureDeclaration} fn - The function.
 * @param {ts.SourceFile} src - Its file.
 * @returns {string} e.g. "advance", or the first 60 characters of its line.
 */
function describe(fn, src) {
  if (fn.name && ts.isIdentifier(fn.name)) return fn.name.text;
  if (ts.isConstructorDeclaration(fn)) return 'constructor';
  const parent = fn.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  const { line } = src.getLineAndCharacterOfPosition(fn.getStart());
  return src.text.split('\n')[line].trim().slice(0, 60);
}

/**
 * What's missing from one function's signature block, if anything.
 *
 * @param {ts.SignatureDeclaration} fn - The function.
 * @param {string} text - Its file's text.
 * @returns {string[]} Each problem, e.g. "no param tag for code"; empty
 *   if it's fully documented.
 */
function problemsWith(fn, text) {
  const block = blockTags(fn, text);
  if (!block) return ['no signature block'];
  /** @type {string[]} */
  const problems = [];
  fn.parameters.forEach(
    /**
     * Checks that one parameter has its param tag.
     *
     * @param {ts.ParameterDeclaration} param - The parameter.
     * @param {number} i - Its position.
     * @returns {void}
     */
    (param, i) => {
    const name = ts.isIdentifier(param.name) ? param.name.text : null;
    // A named parameter needs a @param with its name; a destructured one,
    // which has none, a @param in its position.
    const documented = name === null
      ? Boolean(block.params[i]) && block.params[i].name !== null
      : block.params.some((p, j) => p.name === name || (p.name === '' && j === i));
    if (!documented) problems.push(`no @param for ${name === null ? `parameter ${i + 1}` : name}`);
    },
  );
  const needsReturns = !ts.isConstructorDeclaration(fn) && !ts.isSetAccessorDeclaration(fn);
  if (needsReturns && !block.hasReturns) problems.push('no @returns');
  return problems;
}

/**
 * Checks one file.
 *
 * @param {string} file - Its path, relative to the repository.
 * @returns {string[]} Each problem, as "file:line: name: what's missing".
 */
function checkFile(file) {
  const text = fs.readFileSync(path.join(REPO_DIR, file), 'utf8');
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  /** @type {string[]} */
  const found = [];
  /**
   * Looks at a node, then at everything inside it.
   *
   * @param {ts.Node} node - The node.
   * @returns {void}
   */
  function visit(node) {
    if (ts.isFunctionLike(node) && !ts.isFunctionTypeNode(node) && !ts.isJSDocSignature(node) && 'body' in node && node.body && !isExempt(node, file)) {
      const problems = problemsWith(node, text);
      if (problems.length) {
        const { line } = src.getLineAndCharacterOfPosition(node.getStart());
        found.push(`${file}:${line + 1}: ${describe(node, src)}: ${problems.join(', ')}`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(src);
  return found;
}

const files = documentedFiles();
const problems = files.flatMap(checkFile);
for (const problem of problems) console.log(problem);
console.log(`${files.length} files checked: ${problems.length ? `${problems.length} undocumented or partly documented functions` : 'every function is documented'}.`);
process.exitCode = problems.length ? 1 : 0;

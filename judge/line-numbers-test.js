// Checks that error messages give the line numbers the editor shows (issue
// #26, docs/plans/error-line-numbers.md), and that moving the learner's code
// into a file of its own didn't break judging. Run with:
//   make line-numbers-test     (or: node judge/line-numbers-test.js)
// Each case submits code through runSubmission, as the server does, with a
// mistake on line 3, and looks for that line in what the judge reports.
// Exits 1 if any check fails.

const path = require('path');
const { runSubmission } = require('./runner');

const QUESTIONS = path.join(__dirname, '..', 'questions');
const twoSum = require(path.join(QUESTIONS, 'two-sum.json'));
const linkedList = require(path.join(QUESTIONS, 'singly-linked-list-hello-world.json'));
const helloWorld = require(path.join(QUESTIONS, 'hello-world.json'));

/** @typedef {import('./runner').JudgeResult} JudgeResult */

/**
 * The parts of a question file this test uses.
 *
 * @typedef {object} Question
 * @property {string} [judgeMode]
 * @property {Record<string, string>} [functionName]
 * @property {import('./runner').TestCase[]} testCases
 * @property {Record<string, import('./runner').FunctionSignature>} [signature]
 * @property {Record<string, string>} starterCode
 */

/**
 * Judges code against a question's test cases, as the server's Submit does.
 *
 * @param {Question} question - The question file.
 * @param {string} language - The language.
 * @param {string} code - The code to judge.
 * @param {string} [judgeMode] - The question's judgeMode, or "function".
 * @returns {Promise<JudgeResult>} The verdict.
 */
function submit(question, language, code, judgeMode = question.judgeMode || 'function') {
  return runSubmission({
    language,
    code,
    functionName: question.functionName && question.functionName[language],
    testCases: question.testCases,
    signature: question.signature && question.signature[language],
    judgeMode,
  });
}

/**
 * Everything the judge says about a failure: its error, each test's error,
 * and stderr.
 *
 * @param {JudgeResult} result - The verdict.
 * @returns {string} Those, one per line.
 */
function reportText(result) {
  return [result.error, ...(result.results || []).map((r) => r.error), result.stderr].filter(Boolean).join('\n');
}

// A mistake on line 3 in each language; `expect` is how the message should
// name that line.
/** [language, kind of mistake, code, pattern the report must match]. @type {[string, string, string, RegExp][]} */
const FUNCTION_MISTAKES = [
  ['javascript', 'syntax error', 'function twoSum(nums, target) {\n    const a = 1;\n    const c = ;\n}\n', /main\.js:3\b/],
  ['python', 'syntax error', 'def two_sum(nums, target):\n    x = 1\n    return (\n', /solution\.py", line 3\b/],
  ['python', 'error while loading', 'import math\nx = 1\nundefined_name\ndef two_sum(nums, target):\n    return [0, 1]\n', /solution\.py", line 3\b/],
  ['cpp', 'compile error', 'vector<int> twoSum(vector<int> nums, int target) {\n    int x = 1;\n    return undefined_name;\n}\n', /solution\.cpp:3:\d+: error/],
  ['cpp', 'source excerpt', 'vector<int> twoSum(vector<int> nums, int target) {\n    int x = 1;\n    return undefined_name;\n}\n', /^\s*3 \|\s+return undefined_name;/m],
  ['java', 'compile error', 'class Solution {\n    public int[] twoSum(int[] nums, int target) {\n        return undefinedName;\n    }\n}\n', /Solution\.java:3: error/],
  ['d', 'compile error', 'int[] twoSum(int[] nums, int target) {\n    int x = 1;\n    return undefinedName;\n}\n', /solution\.d\(3\)/],
  // D's solution.d starts with the judge's prelude import on line 1, which
  // mustn't move that line either.
  ['d', 'compile error on line 1', 'int[] twoSum(int[] nums, int target) { return undefinedName; }\n', /solution\.d\(1\)/],
];

// Function judging, runtime errors (step 2): the harness catches the
// exception and adds "(line N)", the deepest line of the learner's code on
// its stack. `lib` cases throw inside a library function called on line 3.
/** [language, kind of mistake, code, pattern the report must match]. @type {[string, string, string, RegExp][]} */
const RUNTIME_MISTAKES = [
  ['javascript', 'runtime error', 'function twoSum(nums, target) {\n    const a = null;\n    return a.boom;\n}\n', /\(line 3\)$/],
  ['javascript', 'library error', 'function twoSum(nums, target) {\n    const a = 1;\n    return JSON.parse("{oops");\n}\n', /\(line 3\)$/],
  ['javascript', 'message mentioning main.js:1', 'function twoSum(nums, target) {\n    const a = 1;\n    throw new Error("see main.js:1:1");\n}\n', /^see main\.js:1:1 \(line 3\)$/],
  ['python', 'runtime error', 'def two_sum(nums, target):\n    a = None\n    return a.boom\n', /\(line 3\)$/],
  ['python', 'library error', 'def two_sum(nums, target):\n    a = 1\n    return int("oops")\n', /\(line 3\)$/],
  ['python', 'exception with no message', 'def two_sum(nums, target):\n    a = 1\n    raise ValueError()\n', /^ValueError \(line 3\)$/],
  ['java', 'runtime error', 'class Solution {\n    public int[] twoSum(int[] nums, int target) {\n        return new int[] { nums[99] };\n    }\n}\n', /\(line 3\)$/],
  ['java', 'library error', 'class Solution {\n    public int[] twoSum(int[] nums, int target) {\n        return new int[] { Integer.parseInt("oops") };\n    }\n}\n', /\(line 3\)$/],
  ['d', 'runtime error', 'int[] twoSum(int[] nums, int target) {\n    int[] a = [1];\n    return [a[5]];\n}\n', /\(line 3\)$/],
  ['d', 'library error', 'int[] twoSum(int[] nums, int target) {\n    int a = 1;\n    return [to!int("oops")];\n}\n', /\(line 3\)$/],
  // C++ exceptions carry no location: the message is left as it was.
  ['cpp', 'exception (no line possible)', 'vector<int> twoSum(vector<int> nums, int target) {\n    int a = 1;\n    throw runtime_error("boom");\n}\n', /^boom$/],
];

// Program judging: the code is the whole file, so its own name and lines.
/** [language, kind of mistake, code, pattern the report must match]. @type {[string, string, string, RegExp][]} */
const PROGRAM_MISTAKES = [
  ['javascript', 'syntax error', 'const a = 1;\nconst b = 2;\nconst c = ;\n', /main\.js:3\b/],
  ['python', 'runtime error', 'a = 1\nb = 2\nNone.boom\n', /main\.py", line 3\b/],
  ['cpp', 'compile error', '#include <iostream>\nint main() {\n    return undefined_name;\n}\n', /main\.cpp:3:\d+: error/],
  ['java', 'compile error', 'public class Main {\n    public static void main(String[] a) {\n        int x = undefinedName;\n    }\n}\n', /Main\.java:3: error/],
  ['d', 'compile error', 'import std.stdio;\nvoid main() {\n    int x = undefinedName;\n}\n', /main\.d\(3\)/],
];

/** A correct answer, by language. @type {Record<string, string>} */
const TWO_SUM_ANSWERS = {
  javascript: 'function twoSum(nums, target) {\n    const seen = new Map();\n    for (let i = 0; i < nums.length; i++) {\n        if (seen.has(target - nums[i])) return [seen.get(target - nums[i]), i];\n        seen.set(nums[i], i);\n    }\n}\n',
  // Uses sys without importing it, a helper and a constant, and an
  // if __name__ == '__main__' block, all of which worked when the code was
  // pasted into the harness.
  python: 'LIMIT = sys.maxsize\n\ndef index_of(seen, value):\n    return seen.get(value)\n\ndef two_sum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        j = index_of(seen, target - n)\n        if j is not None and LIMIT > 0:\n            return [j, i]\n        seen[n] = i\n\nif __name__ == "__main__":\n    print("main block ran")\n',
  cpp: 'vector<int> twoSum(vector<int> nums, int target) {\n    unordered_map<int, int> seen;\n    for (int i = 0; i < (int) nums.size(); i++) {\n        if (seen.count(target - nums[i])) return {seen[target - nums[i]], i};\n        seen[nums[i]] = i;\n    }\n    return {};\n}\n',
  // public class Solution was refused when it shared Main.java; now it's
  // in Solution.java, where it's allowed.
  java: 'import java.util.HashMap;\n\npublic class Solution {\n    public int[] twoSum(int[] nums, int target) {\n        HashMap<Integer, Integer> seen = new HashMap<>();\n        for (int i = 0; i < nums.length; i++) {\n            if (seen.containsKey(target - nums[i])) return new int[] { seen.get(target - nums[i]), i };\n            seen.put(nums[i], i);\n        }\n        return new int[0];\n    }\n}\n',
  // writeln without importing std.stdio: the harness's imports are visible.
  d: 'int[] twoSum(int[] nums, int target) {\n    int[int] seen;\n    foreach (i, n; nums) {\n        if (auto j = (target - n) in seen) return [*j, cast(int) i];\n        seen[n] = cast(int) i;\n    }\n    writeln("no pair");\n    return [];\n}\n',
};

/**
 * The starter code with its empty function body filled in.
 *
 * @param {string} language - The language.
 * @returns {string} A correct answer to singly-linked-list-hello-world.
 */
function linkedListAnswer(language) {
  const starter = linkedList.starterCode[language];
  if (language === 'python') return starter.replace('    pass', '    return SinglyLinkedListNode("Hello", SinglyLinkedListNode("World!"))');
  const value = language === 'javascript' ? "new SinglyLinkedListNode('Hello', new SinglyLinkedListNode('World!'))" : 'new SinglyLinkedListNode("Hello", new SinglyLinkedListNode("World!"))';
  return starter.replace(/\{\n(\s*)\n(\s*)\}/, (/** @type {string} */ _, /** @type {string} */ inner, /** @type {string} */ outer) => `{\n${inner}return ${value};\n${outer}}`);
}

/**
 * Runs every check and prints the results; sets exit code 1 if any fail.
 *
 * @returns {Promise<void>}
 */
async function main() {
  /** @type {string[]} */
  const lines = [];
  let failures = 0;
  /**
   * Records one check's result, for the report.
   *
   * @param {string} name - What it checks.
   * @param {boolean} ok - Whether it passed.
   * @param {string} detail - What the judge said, shown if it failed.
   * @returns {void}
   */
  const check = (name, ok, detail) => {
    if (!ok) failures += 1;
    lines.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      ${detail.replace(/\n/g, '\n      ').slice(0, 600)}`}`);
  };

  for (const [language, kind, code, expect] of FUNCTION_MISTAKES) {
    const text = reportText(await submit(twoSum, language, code));
    check(`function judging, ${language} ${kind}${/line \d/.test(kind) ? "" : " on line 3"}`, expect.test(text), text);
  }
  for (const [language, kind, code, expect] of RUNTIME_MISTAKES) {
    const result = await submit(twoSum, language, code);
    const error = (result.results && result.results[0] && result.results[0].error) || '';
    check(`function judging, ${language} ${kind} on line 3 (runtime)`, result.status === 'Runtime Error' && expect.test(error), `${result.status}: ${error}\n${reportText(result)}`);
  }
  for (const [language, kind, code, expect] of PROGRAM_MISTAKES) {
    const text = reportText(await submit(helloWorld, language, code, 'program'));
    check(`program judging, ${language} ${kind} on line 3`, expect.test(text), text);
  }
  for (const [language, code] of Object.entries(TWO_SUM_ANSWERS)) {
    const result = await submit(twoSum, language, code);
    check(`two-sum in ${language} is Accepted`, result.status === 'Accepted', `${result.status}\n${reportText(result)}`);
    if (language === 'python') check('python: sys without import, helpers, and the __main__ block still work', /main block ran/.test(result.stdout), result.stdout);
  }
  // D: a function named like a standard one (std.algorithm's reverse) is
  // still the one called.
  {
    const result = await runSubmission({
      language: 'd',
      code: 'int[] reverse(int[] nums) {\n    return nums.retro.array;\n}\n',
      functionName: 'reverse',
      testCases: [{ args: [[1, 2, 3]], expected: [3, 2, 1], hidden: false }],
      signature: { params: ['int[]'], returns: 'int[]' },
      judgeMode: 'function',
    });
    check('d: a function named reverse (like std.algorithm\'s) is Accepted', result.status === 'Accepted', `${result.status}\n${reportText(result)}`);
  }
  for (const language of Object.keys(linkedList.starterCode)) {
    const result = await submit(linkedList, language, linkedListAnswer(language));
    check(`singly-linked-list in ${language} is Accepted (custom serializer)`, result.status === 'Accepted', `${result.status}\n${reportText(result)}`);
  }

  console.log(lines.join('\n'));
  console.log(`\n${lines.length - failures} passed, ${failures} failed.`);
  process.exitCode = failures ? 1 : 0;
}

main().catch(
  /**
   * Prints an error main() didn't expect, and fails the run.
   *
   * @param {unknown} err - What was thrown.
   * @returns {void}
   */
  (err) => {
    console.error(err);
    process.exitCode = 1;
  },
);

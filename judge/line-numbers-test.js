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

// Everything the judge says about a failure: its error, each test's error,
// and stderr.
function reportText(result) {
  return [result.error, ...(result.results || []).map((r) => r.error), result.stderr].filter(Boolean).join('\n');
}

// A mistake on line 3 in each language; `expect` is how the message should
// name that line.
const FUNCTION_MISTAKES = [
  ['javascript', 'syntax error', 'function twoSum(nums, target) {\n    const a = 1;\n    const c = ;\n}\n', /main\.js:3\b/],
  ['python', 'syntax error', 'def two_sum(nums, target):\n    x = 1\n    return (\n', /solution\.py", line 3\b/],
  ['python', 'error while loading', 'import math\nx = 1\nundefined_name\ndef two_sum(nums, target):\n    return [0, 1]\n', /solution\.py", line 3\b/],
  ['cpp', 'compile error', 'vector<int> twoSum(vector<int> nums, int target) {\n    int x = 1;\n    return undefined_name;\n}\n', /solution\.cpp:3:\d+: error/],
  ['cpp', 'source excerpt', 'vector<int> twoSum(vector<int> nums, int target) {\n    int x = 1;\n    return undefined_name;\n}\n', /^\s*3 \|\s+return undefined_name;/m],
  ['java', 'compile error', 'class Solution {\n    public int[] twoSum(int[] nums, int target) {\n        return undefinedName;\n    }\n}\n', /Solution\.java:3: error/],
  ['d', 'compile error', 'int[] twoSum(int[] nums, int target) {\n    int x = 1;\n    return undefinedName;\n}\n', /solution\.d\(3\)/],
];

// Program judging: the code is the whole file, so its own name and lines.
const PROGRAM_MISTAKES = [
  ['javascript', 'syntax error', 'const a = 1;\nconst b = 2;\nconst c = ;\n', /main\.js:3\b/],
  ['python', 'runtime error', 'a = 1\nb = 2\nNone.boom\n', /main\.py", line 3\b/],
  ['cpp', 'compile error', '#include <iostream>\nint main() {\n    return undefined_name;\n}\n', /main\.cpp:3:\d+: error/],
  ['java', 'compile error', 'public class Main {\n    public static void main(String[] a) {\n        int x = undefinedName;\n    }\n}\n', /Main\.java:3: error/],
  ['d', 'compile error', 'import std.stdio;\nvoid main() {\n    int x = undefinedName;\n}\n', /main\.d\(3\)/],
];

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

// The starter code with its empty function body filled in.
function linkedListAnswer(language) {
  const starter = linkedList.starterCode[language];
  if (language === 'python') return starter.replace('    pass', '    return SinglyLinkedListNode("Hello", SinglyLinkedListNode("World!"))');
  const value = language === 'javascript' ? "new SinglyLinkedListNode('Hello', new SinglyLinkedListNode('World!'))" : 'new SinglyLinkedListNode("Hello", new SinglyLinkedListNode("World!"))';
  return starter.replace(/\{\n(\s*)\n(\s*)\}/, (_, inner, outer) => `{\n${inner}return ${value};\n${outer}}`);
}

async function main() {
  const lines = [];
  let failures = 0;
  const check = (name, ok, detail) => {
    if (!ok) failures += 1;
    lines.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      ${detail.replace(/\n/g, '\n      ').slice(0, 600)}`}`);
  };

  for (const [language, kind, code, expect] of FUNCTION_MISTAKES) {
    const text = reportText(await submit(twoSum, language, code));
    check(`function judging, ${language} ${kind} on line 3`, expect.test(text), text);
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
  for (const language of Object.keys(linkedList.starterCode)) {
    const result = await submit(linkedList, language, linkedListAnswer(language));
    check(`singly-linked-list in ${language} is Accepted (custom serializer)`, result.status === 'Accepted', `${result.status}\n${reportText(result)}`);
  }

  console.log(lines.join('\n'));
  console.log(`\n${lines.length - failures} passed, ${failures} failed.`);
  process.exitCode = failures ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

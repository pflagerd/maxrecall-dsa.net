"""The author's reference solution for the prototype question.

The driver runs the tests against it once, to list them: the list never
comes from the learner's code.
"""


def count_vowels(s):
    """Returns how many of the characters in s are vowels, a e i o u, in either case."""
    return sum(1 for ch in s.lower() if ch in "aeiou")

"""Visible tests for count_vowels: shown to the learner (blurred until Run)."""
import unittest

from solution import count_vowels


class VisibleTests(unittest.TestCase):
    def test_a_word(self):
        self.assertEqual(count_vowels("hello"), 2)

    def test_empty_string(self):
        self.assertEqual(count_vowels(""), 0)


if __name__ == "__main__":
    unittest.main()

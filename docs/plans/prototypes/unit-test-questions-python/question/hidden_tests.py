"""Hidden tests for count_vowels: never sent to the browser."""
import unittest

from solution import count_vowels


class HiddenTests(unittest.TestCase):
    def test_capitals(self):
        self.assertEqual(count_vowels("AEIOU"), 5)

    def test_mixed_case_sentence(self):
        self.assertEqual(count_vowels("Programming Is Fun"), 5)

    def test_no_vowels(self):
        self.assertEqual(count_vowels("rhythm"), 0)


if __name__ == "__main__":
    unittest.main()

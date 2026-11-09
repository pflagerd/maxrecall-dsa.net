# Throws on the empty string: an error, not a failed assertion.
def count_vowels(s):
    if not s:
        raise ValueError("empty string")
    return sum(1 for ch in s.lower() if ch in "aeiou")

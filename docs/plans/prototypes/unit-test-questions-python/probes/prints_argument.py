# Right, with a debugging print left in: an accidental leak of each test's input.
def count_vowels(s):
    print("count_vowels called with", repr(s))
    return sum(1 for ch in s.lower() if ch in "aeiou")

# A plausible mistake: forgets capitals. Passes both visible tests.
def count_vowels(s):
    return sum(1 for ch in s if ch in "aeiou")

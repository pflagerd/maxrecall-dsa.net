# The fill-in-the-blank box has room for exactly `maxLength` characters

2026-11-10 (UTC) · decided by the owner · written by core

**Decided** (owner, 2026-11-10, in questions-2's session; core read it in
PR 228's description, "Decided by the owner", not the owner's own words):
the box of `single-quote-in-double-quotes` is to be **exactly 3
characters wide**, accepting 3. PR 228 (questions) sets that question's
`maxLength` to 3. The width is core's (`problem-page.js`,
`renderTemplate`), asked of core by questions-2 (`send_message`,
2026-11-10 19:22 UTC).

**What changes.** The box was `maxLength + 1` characters wide
(`docs/decisions/20261109T160135-0800-fill-in-the-blank-page.md`, item
3: "about that many characters wide"). Now:

- `problem-page.js`: `box.style.width` is `maxLength` in `ch`. One `ch`
  is the width of the font's `0`, so in the template's monospace font
  it is one character.
- `style.css`: the box is `box-sizing: content-box`, so that width is
  the room for text, and the box's padding (0.15ch each side) is added
  outside it. The rest of the page is `border-box`.

It applies to every fill-in-the-blank question; there is one.

**Why the `+ 1` was there**: not recorded (the commit, `7553a2f`, and
the decision above don't say). **A guess** from what was measured: the
page's `* { box-sizing: border-box }` takes the padding out of the
width, so a box `maxLength` ch wide has room for 0.3ch less than
`maxLength` characters, and the extra character made up for it.

**Measured** (Chromium, a cloud session, `style.css` with a 3-character
answer and the text cursor at its end; 1ch was 7.83 px):

| The box | Outside width | Scrolls its text? |
|---|---|---|
| before: `4ch`, border-box | 31.3 px | no |
| `3ch`, border-box (the `+ 1` removed and nothing else) | 23.5 px | **yes**, by 2 px |
| **chosen**: `3ch`, content-box | 25.8 px | no |
| `3ch`, no padding | 23.5 px | no |

**The choice between the last two is core's, and small**: the chosen
one keeps the 0.15ch of padding each side, so the outside is 3.3
characters and a quote doesn't touch the box's edge. With no padding
the outside would be 3 characters to the pixel, with the text against
both edges. The owner may prefer that; it is one line of `style.css`.

**Not checked**: Firefox, Safari, a phone (only Chromium is in the cloud
session); and the real problem page, which a cloud session can't load
without its CDN: the measurement used the page's stylesheet and an
input built as `renderTemplate` builds it.

Source: `problem-page.js` (`renderTemplate`), `style.css`
(`.fill-in-template .fill-in-blank`).

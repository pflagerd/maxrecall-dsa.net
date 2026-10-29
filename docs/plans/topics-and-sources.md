# Plan: topics and sources as coloured bubbles

Status: **all decided 2026-10-29; in progress.** Steps 1–2 done.
Comes from the `TODO` note "Next to the difficulty bubble, allow other bubbles…".
Linked from `readme.html` → Decisions & plans.

## Where things stand

- Every question file already has `tags`, a list of names such as
  `["Array", "Hash Table"]`. The server passes them through to the browser.
- They're shown as plain text. The problem list joins them with commas
  (`problems-list.js`, line 25). The problem page joins them with " · " in the
  description pane (`problem-page.js`, line 449), not in the header next to the
  difficulty.
- "Bubbles" already exist: the `.badge` class, coloured by `difficulty-easy`,
  `difficulty-medium` and `difficulty-hard` (`style.css`, lines 125–143).

## Decided (2026-10-29)

1. **Colours live in one shared file**, not in each question. Question files list
   names only. This keeps each name's colour the same everywhere, and recolouring
   doesn't change any question's `questionSha256`.
2. **Topics and sources are kept apart.** A *topic* says what a question is about
   ("Array"). A *source* says where it comes from ("Cracking the Coding
   Interview"). Each will be able to have an optional link at some point.
3. **Bubbles appear on both pages**: next to the difficulty on the problem page,
   and in the problem list. The problem list is likely to be replaced when
   spaced repetition is built, so it gets the simple version.
4. Within each kind, bubbles keep the order they have in the question file.

## Details decided 2026-10-29: all as recommended

T1 a (`topics` + `sources`), T2 `labels.json` at the top level, T3 sources
outlined and topics filled, T4 difficulty → sources → topics in the header,
T5 `labels.json` served as a static file. The options are kept below for the
record.

**Correction:** T2 below first said the colour pairs work "in light and dark
mode". The app has only a dark theme (`style.css`, `:root`, background
`#0f172a`); only `readme.html` has a light mode. Colours are chosen and
contrast-checked for the dark page.

## Details considered

### T1. Field names in question files

| Option | Question file | For | Against |
|---|---|---|---|
| **a. Rename `tags` to `topics`, add `sources`** (recommended) | `"topics": ["Array"], "sources": ["Cracking the Coding Interview"]` | Says what it means, and matches the decision to keep the two apart. Cheap now: 9 files. | Touches all 9 files, and so changes every question's SHA-256 once. That's harmless while there are no real records yet. |
| b. Keep `tags` (meaning topics), add `sources` | `"tags": […], "sources": […]` | Question files stay as they are, apart from adding `sources`. | "tags" stays vague alongside "sources". |

### T2. The shared file

Recommended: **`labels.json` at the top level of the repo.** It can't go in
`questions/`, because `listProblems` treats every `.json` file there as a question.

```json
{
  "topics": {
    "Array": { "background": "#dbe7ff", "text": "#1d3f8a" }
  },
  "sources": {
    "Cracking the Coding Interview": { "background": "#fff1d6", "text": "#6b4400",
                                       "link": "https://…" }
  }
}
```

- `background` and `text` are set as a pair, so the text stays readable. WCAG
  asks for a contrast ratio of at least 4.5:1
  ([WCAG 2.2, 1.4.3](https://www.w3.org/TR/WCAG22/#contrast-minimum)).
- `link` is optional. This step only reserves the name, and nothing displays it
  yet. A later step can turn the bubble into a link.
- A name that isn't listed gets a default style for its kind. This means a new
  topic shows up straight away, with no edit to `labels.json` needed.

### T3. Telling sources from topics at a glance

Recommended: **sources are outlined bubbles, topics are filled ones**, so the two
kinds look different even when they have no colours of their own.

### T4. Order on the problem page

Recommended: **difficulty, then sources, then topics**, all in the header. The
" · " text line in the description pane goes away.

### T5. How the browser gets `labels.json`

| Option | For | Against |
|---|---|---|
| **a. Serve it as a static file** (recommended) | Smallest change: add `labels.json` to `STATIC_FILES` in `server.js`. | Colour values are only checked in the browser. |
| b. `GET /api/labels`, checked by the server | Bad entries are caught in one place. | More code, and checking CSS colours on the server needs a library or a hand-written pattern. |

Either way, the browser checks each colour with
[`CSS.supports('color', value)`](https://developer.mozilla.org/en-US/docs/Web/API/CSS/supports_static)
and sets it through `element.style`, never by building HTML strings. While
the bubble code is being changed anyway, names will be escaped too. Today's
`problems-list.js` inserts tag names without escaping.

## Steps (once T1–T5 are decided)

1. Add `sources` (and the rename, if T1a). Update `readme.html` §5.
2. Add `labels.json` and serve it. Update `readme.html` §3 and §4.
3. Render bubbles on the problem page, and the CSS for them (T3, T4).
4. Render bubbles in the problem list.
5. Later: show `link` as a clickable bubble.

## Effects later on

- Changing colours or links never changes `questionSha256`, but editing a question's
  `topics` or `sources` does. That's the "too sensitive" weakness of hashing the
  whole file, which was knowingly accepted on 2026-10-29.
- Spaced repetition could later filter or weight by topic or source, for example
  "practise Hash Table" or "only questions from Cracking the Coding Interview",
  using the same names.

# A judge file's hash is taken when it's loaded, and given by judgeSha256Of, not in the result

2026-11-09 (UTC; the same day Pacific) · decided by the owner (option b, in users' session: "use b"); the shape by questions-2 · written by questions (questions-2)

**The need** (users' request, records version 4's `judgeSha256`,
`docs/plans/submission-records-v4.md` D6, #168): a fill-in-the-blank
record names the judge file that judged it.

**Decided** (owner, option b): **the hash is taken when the judge is
loaded**, not by users per request. `loadJudge` `require`s the file, and
Node keeps the first-loaded code until a restart
([Node docs, caching](https://nodejs.org/api/modules.html#caching)). So
a judge changed under a running server would otherwise be recorded with
the new file's hash while the old code judged. Infrastructure and
security's #160 review advised the same.

**The shape** (questions-2, the request left it to questions):
- `judge/fill-in-the-blank.js` reads the file's bytes just before its
  first `require` (or after its cache entry is dropped). It keeps their
  SHA-256 in a map by path.
- **`judgeSha256Of(question)`** returns that hash, loading the judge if
  needed. So a Skip, which judges nothing, gets the same hash a Submit
  would.
- **It isn't added to `judgeFillInTheBlank`'s result.** `routes.js`
  sends that result to the browser as it is (`res.json(…)`, line 509).
  Adding it there would have sent the hash to the page until users
  stripped it (contract 4: nothing of the judge is sent).
- The result's shape in contract 2 is unchanged. Only the list of what
  crosses gains `judgeSha256Of` (the architect's).

**The one gap**: a change to the file in the moment between the read and
the `require`.

Source: `judge/fill-in-the-blank.js` (`judgeHashes`, `loadJudge`,
`judgeSha256Of`), `questions.test.js`; `readme.html`, Layout.

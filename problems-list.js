// index.html has both elements, hence the casts. textContent is given a
// number, which the browser turns into text; the cast says that's intended.
/** @type {HTMLElement} */ (document.getElementById('year')).textContent = /** @type {any} */ (new Date().getFullYear());

const rowsEl = /** @type {HTMLElement} */ (document.getElementById('problem-rows'));

/**
 * The CSS class for a difficulty badge.
 *
 * @param {unknown} difficulty - "Easy", "Medium" or "Hard", from the question.
 * @returns {string} e.g. "difficulty-easy" (style.css colours these).
 */
function difficultyClass(difficulty) {
  return `difficulty-${String(difficulty || '').toLowerCase()}`;
}

/**
 * Fetches the problem list and fills the table: one row per question, with
 * its bubbles and difficulty, each opening the question when clicked. On
 * failure the table says why.
 *
 * @returns {Promise<void>} Never rejects: failures are shown in the table.
 */
async function loadProblems() {
  // Fetched alongside the list; loadLabels() (bubbles.js) never rejects.
  const labelsPromise = loadLabels();
  try {
    const res = await fetch('/api/questions');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    /** GET /api/questions: one summary per question. @type {{ slug: string, title: string, difficulty: string, topics: string[], sources: string[] }[]} */
    const problems = await res.json();

    if (!problems.length) {
      rowsEl.innerHTML = '<tr><td colspan="3">No problems yet.</td></tr>';
      return;
    }

    rowsEl.innerHTML = problems
      .map(
        (p) => `
        <tr class="problem-row" data-slug="${p.slug}">
          <td class="problem-title">${p.title}</td>
          <td class="problem-bubbles"><span class="bubbles"></span></td>
          <td><span class="badge ${difficultyClass(p.difficulty)}">${p.difficulty}</span></td>
        </tr>`
      )
      .join('');

    // Bubbles are added as elements, not in the HTML string above, so
    // names from question files can't inject markup.
    const labels = await labelsPromise;
    rowsEl.querySelectorAll('.problem-bubbles .bubbles').forEach((el, i) => {
      renderBubbles(el, problems[i], labels);
    });

    rowsEl.querySelectorAll('.problem-row').forEach((row) => {
      row.addEventListener('click', () => {
        // Every row was written with data-slug, above.
        window.location.href = `/problem.html?slug=${encodeURIComponent(/** @type {string} */ (/** @type {HTMLElement} */ (row).dataset.slug))}`;
      });
    });
  } catch (err) {
    rowsEl.innerHTML = `<tr><td colspan="3">Failed to load problems: ${/** @type {Error} */ (err).message}</td></tr>`;
  }
}

loadProblems();

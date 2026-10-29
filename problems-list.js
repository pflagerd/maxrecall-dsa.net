document.getElementById('year').textContent = new Date().getFullYear();

const rowsEl = document.getElementById('problem-rows');

function difficultyClass(difficulty) {
  return `difficulty-${String(difficulty || '').toLowerCase()}`;
}

async function loadProblems() {
  // Fetched alongside the list; loadLabels() (bubbles.js) never rejects.
  const labelsPromise = loadLabels();
  try {
    const res = await fetch('/api/questions');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
        window.location.href = `/problem.html?slug=${encodeURIComponent(row.dataset.slug)}`;
      });
    });
  } catch (err) {
    rowsEl.innerHTML = `<tr><td colspan="3">Failed to load problems: ${err.message}</td></tr>`;
  }
}

loadProblems();

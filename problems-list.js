document.getElementById('year').textContent = new Date().getFullYear();

const rowsEl = document.getElementById('problem-rows');

function difficultyClass(difficulty) {
  return `difficulty-${String(difficulty || '').toLowerCase()}`;
}

async function loadProblems() {
  try {
    const res = await fetch('/api/problems');
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
          <td class="problem-tags">${(p.tags || []).join(', ')}</td>
          <td><span class="badge ${difficultyClass(p.difficulty)}">${p.difficulty}</span></td>
        </tr>`
      )
      .join('');

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

document.getElementById('year').textContent = new Date().getFullYear();

const statusEl = document.getElementById('status');
const btn = document.getElementById('ping-btn');

btn.addEventListener('click', async () => {
  statusEl.textContent = 'Pinging...';
  try {
    const res = await fetch('/api/hello');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    statusEl.textContent = `${data.message} (at ${data.time})`;
  } catch (err) {
    statusEl.textContent = `Error reaching server: ${err.message}`;
  }
});

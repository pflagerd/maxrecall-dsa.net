// Shows who's signed in, with a Log out button, in the page header's
// #account element. Used by the problem list and the problem page.
(async function showAccount() {
  const el = document.getElementById('account');
  if (!el) return;
  let me;
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) return;
    me = await res.json();
  } catch {
    return;
  }

  const name = document.createElement('span');
  name.className = 'account-email';
  name.textContent = me.email;

  // On the trusted port (the VPS's SSH tunnel) there's no session to end.
  if (me.trusted) {
    const marker = document.createElement('span');
    marker.className = 'account-trusted';
    marker.textContent = 'trusted (SSH tunnel)';
    marker.title = 'Signed in automatically because you came in on the trusted port';
    el.replaceChildren(name, marker);
    return;
  }

  const logout = document.createElement('button');
  logout.type = 'button';
  logout.textContent = 'Log out';
  logout.addEventListener('click', async () => {
    logout.disabled = true;
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }).catch(() => {});
    window.location.replace('/login.html');
  });

  el.replaceChildren(name, logout);
})();

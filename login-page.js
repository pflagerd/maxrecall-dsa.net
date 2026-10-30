// The login page: Log in, or Register (#register in the address). On
// success, goes to wherever the gate sent you here from (?next=).

const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const errorEl = document.getElementById('auth-error');

// Only a path on this site: "//host" or "/\host" would leave it (browsers
// read both as another host), which would make this an open redirect.
function nextPath() {
  const next = new URLSearchParams(window.location.search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';
}

function showMode() {
  const registering = window.location.hash === '#register';
  loginForm.hidden = registering;
  registerForm.hidden = !registering;
  errorEl.textContent = '';
  (registering ? registerForm : loginForm).querySelector('input').focus();
}

async function signIn(url, form, body) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  errorEl.textContent = '';
  try {
    // fetch itself only fails when no answer came back at all (server
    // stopped, wrong address). Browsers word that differently ("Failed to
    // fetch", "NetworkError…", "Load failed"), so say what it means instead.
    // Errors the server sends back are shown as they are.
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error("Can't reach the server. Is it running? Check the terminal where you started it.");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    window.location.replace(nextPath());
  } catch (err) {
    errorEl.textContent = err.message;
    button.disabled = false;
  }
}

loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  signIn('/api/auth/login', loginForm, { email: loginForm.email.value, password: loginForm.password.value });
});

registerForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (registerForm.password.value !== registerForm.confirm.value) {
    errorEl.textContent = "The passwords don't match.";
    return;
  }
  signIn('/api/auth/register', registerForm, { email: registerForm.email.value, password: registerForm.password.value });
});

window.addEventListener('hashchange', showMode);
showMode();

// Already signed in? Then there's nothing to do here.
fetch('/api/auth/me')
  .then((res) => {
    if (res.ok) window.location.replace(nextPath());
  })
  .catch(() => {}); // Server unreachable: the forms will say so when used.

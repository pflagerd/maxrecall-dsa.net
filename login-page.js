// The login page: Log in, or Register (#register in the address). On
// success, goes to wherever the gate sent you here from (?next=).

// The two forms, with the controls they have by name (login.html). Every
// lookup below finds an element login.html has, hence the casts.
/** @typedef {HTMLFormElement & { email: HTMLInputElement, password: HTMLInputElement }} LoginForm */
/** @typedef {LoginForm & { confirm: HTMLInputElement }} RegisterForm */

const loginForm = /** @type {LoginForm} */ (document.getElementById('login-form'));
const registerForm = /** @type {RegisterForm} */ (document.getElementById('register-form'));
const errorEl = /** @type {HTMLElement} */ (document.getElementById('auth-error'));

/**
 * Where to go after signing in: ?next= from the address, but only a path on
 * this site. "//host" or "/\host" would leave it (browsers read both as
 * another host), which would make this an open redirect.
 *
 * @returns {string} The ?next= path if it's safe, otherwise "/".
 */
function nextPath() {
  const next = new URLSearchParams(window.location.search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';
}

/**
 * Shows the login form, or the register form when the address ends in
 * #register, clears any error, and focuses the form's first field.
 *
 * @returns {void}
 */
function showMode() {
  const registering = window.location.hash === '#register';
  loginForm.hidden = registering;
  registerForm.hidden = !registering;
  errorEl.textContent = '';
  // Both forms start with an <input> (login.html).
  /** @type {HTMLInputElement} */ ((registering ? registerForm : loginForm).querySelector('input')).focus();
}

/**
 * Sends a login or register request. On success, goes to nextPath(); on
 * failure, shows why and enables the form's button again.
 *
 * @param {string} url - /api/auth/login or /api/auth/register.
 * @param {HTMLFormElement} form - The form sent, whose button is disabled
 *   meanwhile.
 * @param {{ email: string, password: string }} body - What to send, as JSON.
 * @returns {Promise<void>} Never rejects: failures are shown on the page.
 */
async function signIn(url, form, body) {
  // Each form has one submit button (login.html).
  const button = /** @type {HTMLButtonElement} */ (form.querySelector('button[type="submit"]'));
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
    errorEl.textContent = /** @type {Error} */ (err).message;
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

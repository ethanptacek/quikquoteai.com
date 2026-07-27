import { supa, configured, getSession, $ } from './supa.js';

const form = $('#login-form');
const status = $('#login-status');
const btn = $('#login-btn');

if (!configured) {
  status.textContent =
    'The backend isn’t connected yet — this workspace goes live once Supabase is provisioned.';
  btn.disabled = true;
  btn.style.opacity = 0.5;
} else {
  // Already signed in? Straight to the workspace.
  getSession().then((s) => {
    if (s) window.location.replace('/app');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    btn.disabled = true;
    status.textContent = 'Checking…';
    const email = $('#email').value.trim();
    const password = $('#password').value;

    const { error } = await supa.auth.signInWithPassword({ email, password });
    if (error) {
      btn.disabled = false;
      status.textContent =
        error.message === 'Invalid login credentials'
          ? 'That email/password combo didn’t match.'
          : error.message;
      return;
    }
    status.textContent = 'Welcome back — loading your workspace…';
    window.location.href = '/app';
  });
}

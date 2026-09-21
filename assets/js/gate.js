(() => {
  'use strict';

  const logo   = document.getElementById('logo');
  const gate   = document.getElementById('gate');
  const term   = document.getElementById('term');
  const form   = document.getElementById('pwform');
  const input  = document.getElementById('pw');
  const msg    = document.getElementById('msg');
  const button = form.querySelector('button[type="submit"]');

  let open = false;

  function openTerm() {
    open = true;
    gate.classList.add('open');
    logo.setAttribute('aria-expanded', 'true');
    term.classList.remove('hidden');
    // one frame so the "hidden -> visible" transition actually runs
    requestAnimationFrame(() => term.classList.add('show'));
    input.value = '';
    msg.textContent = '';
    msg.className = '';
    input.disabled = false;
    button.disabled = false;
    setTimeout(() => input.focus(), 180);
  }

  function closeTerm() {
    open = false;
    term.classList.remove('show');
    gate.classList.remove('open');
    logo.setAttribute('aria-expanded', 'false');
    setTimeout(() => { if (!open) term.classList.add('hidden'); }, 220);
  }

  logo.addEventListener('click', () => (open ? closeTerm() : openTerm()));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) closeTerm();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = input.value;
    if (!password) {
      input.focus();
      return;
    }

    input.disabled = true;
    button.disabled = true;
    msg.className = '';
    msg.textContent = 'CHECKING…';

    let data = null;
    try {
      const res = await fetch('api/auth.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      data = await res.json();
    } catch (err) {
      msg.textContent = 'CONNECTION ERROR — TRY AGAIN';
      msg.className = 'bad';
      input.disabled = false;
      button.disabled = false;
      return;
    }

    const ok = !!(data && data.ok);
    msg.textContent = ok ? 'ACCESS GRANTED' : 'ACCESS DENIED';
    msg.className = ok ? 'good' : 'bad';

    const redirect = (data && data.redirect) || 'https://www.google.com';
    setTimeout(() => { window.location.href = redirect; }, 650);
  });
})();

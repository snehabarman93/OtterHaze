/* Quiet contact form: toggles from the footer link and sends via Web3Forms. */
(function () {
  var toggle = document.getElementById('helloToggle');
  var form = document.getElementById('hello');
  var status = document.getElementById('helloStatus');
  if (!toggle || !form) return;

  var send = form.querySelector('.hello__send');
  var idle = status.textContent;

  toggle.addEventListener('click', function () {
    var open = form.hidden;
    form.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) form.querySelector('textarea[name="message"]').focus();
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    status.textContent = 'Sending…';
    send.disabled = true;
    fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: new FormData(form)
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data && data.success) {
          status.textContent = 'Thanks, got it.';
          form.reset();
        } else {
          status.textContent = 'Something went wrong. Please try again.';
        }
      })
      .catch(function () {
        status.textContent = 'Network error. Please try again.';
      })
      .then(function () {
        send.disabled = false;
        setTimeout(function () { if (status.textContent === 'Thanks, got it.') status.textContent = idle; }, 6000);
      });
  });
})();

/* ============================================================
   MAINFRAME RESEARCH — Main JS
   ============================================================ */

// --- Mobile nav toggle ---
const hamburger = document.getElementById('hamburger');
const mobileNav = document.getElementById('mobileNav');

if (hamburger && mobileNav) {
  hamburger.addEventListener('click', () => {
    mobileNav.classList.toggle('open');
  });
  // Close on link click
  mobileNav.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => mobileNav.classList.remove('open'));
  });
}

// --- Active nav link ---
(function () {
  const path = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.header-nav a, .mobile-nav a').forEach(a => {
    const href = a.getAttribute('href');
    if (href === path || (path === '' && href === 'index.html')) {
      a.classList.add('active');
    }
  });
})();

// --- MOMCI Survey logic ---
const surveyForm = document.getElementById('momciForm');

if (surveyForm) {

  // Toil slider sync (reactive + proactive must = 100)
  const reactiveSlider  = document.getElementById('reactive');
  const proactiveSlider = document.getElementById('proactive');
  const reactiveVal     = document.getElementById('reactiveVal');
  const proactiveVal    = document.getElementById('proactiveVal');
  const toilTotal       = document.getElementById('toilTotal');

  function syncToil(changed) {
    let r = parseInt(reactiveSlider.value);
    let p = parseInt(proactiveSlider.value);

    if (changed === 'reactive') {
      p = 100 - r;
      proactiveSlider.value = p;
    } else {
      r = 100 - p;
      reactiveSlider.value = r;
    }

    reactiveVal.textContent  = r + '%';
    proactiveVal.textContent = p + '%';
    toilTotal.textContent = 'Total: ' + (r + p) + '%';
    toilTotal.className = 'toil-total'; // always 100
  }

  if (reactiveSlider) {
    reactiveSlider.addEventListener('input',  () => syncToil('reactive'));
    proactiveSlider.addEventListener('input', () => syncToil('proactive'));
    syncToil('reactive'); // init
  }

  // Rating group — allow clicking selected to deselect (optional)
  document.querySelectorAll('.rating-group label').forEach(label => {
    label.addEventListener('mouseenter', function () {
      const idx = parseInt(this.dataset.val);
      document.querySelectorAll('.rating-group label').forEach((l, i) => {
        l.style.background = i < idx ? '#000' : '';
        l.style.color      = i < idx ? '#fff' : '';
        l.style.borderColor = i < idx ? '#000' : '';
      });
    });
    label.addEventListener('mouseleave', function () {
      document.querySelectorAll('.rating-group label').forEach(l => {
        l.style.background  = '';
        l.style.color       = '';
        l.style.borderColor = '';
      });
    });
  });

  // Form submit
  surveyForm.addEventListener('submit', function (e) {
    e.preventDefault();

    // Basic validation
    let valid = true;
    const required = surveyForm.querySelectorAll('[required]');
    required.forEach(el => {
      el.style.borderColor = '';
      if (!el.value.trim()) {
        el.style.borderColor = '#CC2200';
        valid = false;
      }
    });

    // Check at least one radio per group
    const radioNames = new Set();
    surveyForm.querySelectorAll('input[type="radio"][required]').forEach(r => radioNames.add(r.name));
    radioNames.forEach(name => {
      const checked = surveyForm.querySelector(`input[name="${name}"]:checked`);
      if (!checked) {
        const group = surveyForm.querySelector(`input[name="${name}"]`).closest('.form-group');
        if (group) {
          group.style.outline = '2px solid #CC2200';
          valid = false;
        }
      } else {
        const group = surveyForm.querySelector(`input[name="${name}"]`).closest('.form-group');
        if (group) group.style.outline = '';
      }
    });

    if (!valid) {
      surveyForm.querySelector('[style*="CC2200"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    // Disable submit button while sending
    const submitBtn = surveyForm.querySelector('[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';

    const data = Object.fromEntries(new FormData(surveyForm));

    fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
      .then(res => res.json())
      .then(json => {
        if (!json.ok) throw new Error(json.error || 'Submission failed.');
        surveyForm.style.display = 'none';
        const success = document.getElementById('successMsg');
        if (success) {
          success.style.display = 'block';
          success.scrollIntoView({ behavior: 'smooth' });
        }
      })
      .catch(err => {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit MOMCI 2026 Response';
        alert('There was a problem submitting your response: ' + err.message + '\n\nPlease try again.');
      });
  });
}

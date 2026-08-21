// PETROL INDUSTRIES — FW26 B2B Season Preview
document.addEventListener('DOMContentLoaded', () => {

  /* Access gate */
  const gateForm = document.querySelector('#gate-form');
  if (gateForm) {
    const errorEl = document.querySelector('.gate-overlay__error');
    const input = document.querySelector('#gate-password');
    gateForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const expected = window.__PETROL_GATE_PASSWORD__ || '';
      if (input.value === expected) {
        try { sessionStorage.setItem('petrol_gate_ok', '1'); } catch (err) {}
        document.documentElement.classList.remove('is-gated');
      } else {
        errorEl.textContent = 'Incorrect access code — please try again.';
        input.value = '';
        input.focus();
      }
    });
  }

  /* Top bar scroll state */
  const topbar = document.querySelector('.topbar');
  const onScroll = () => {
    if (!topbar) return;
    topbar.classList.toggle('is-scrolled', window.scrollY > 40);
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* Mobile nav toggle */
  const toggle = document.querySelector('.nav-toggle');
  const links = document.querySelector('.nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', () => {
      links.classList.toggle('is-open');
    });
    links.querySelectorAll('a').forEach(a => a.addEventListener('click', () => links.classList.remove('is-open')));
  }

  /* Scroll reveal */
  const revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });
    revealEls.forEach(el => io.observe(el));
  } else {
    revealEls.forEach(el => el.classList.add('is-visible'));
  }

  /* Click-to-play YouTube facade */
  document.querySelectorAll('[data-youtube]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-youtube');
      el.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0" title="Petrol Heritage" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen style="width:100%;height:100%;display:block;"></iframe>`;
    }, { once: true });
  });

  /* Lightbox for gallery */
  const lightbox = document.querySelector('.lightbox');
  if (lightbox) {
    const lightboxImg = lightbox.querySelector('img');
    document.querySelectorAll('[data-lightbox]').forEach(trigger => {
      trigger.addEventListener('click', () => {
        const full = trigger.getAttribute('data-lightbox');
        lightboxImg.setAttribute('src', full);
        lightbox.classList.add('is-open');
        document.body.style.overflow = 'hidden';
      });
    });
    const closeLightbox = () => {
      lightbox.classList.remove('is-open');
      document.body.style.overflow = '';
    };
    lightbox.querySelector('.lightbox__close').addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });
  }

  /* vCard download for sales contacts */
  document.querySelectorAll('[data-vcard]').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.getAttribute('data-name') || 'Petrol Industries';
      const role = btn.getAttribute('data-role') || '';
      const email = btn.getAttribute('data-email') || '';
      const phone = btn.getAttribute('data-phone') || '';
      const vcard = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `N:${name};;;;`,
        `FN:${name}`,
        `ORG:Petrol Industries`,
        `TITLE:${role}`,
        email ? `EMAIL:${email}` : '',
        phone ? `TEL:${phone}` : '',
        'END:VCARD'
      ].filter(Boolean).join('\n');
      const blob = new Blob([vcard], { type: 'text/vcard' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name.replace(/\s+/g, '_') || 'contact'}.vcf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  });

  /* Contact form -> Cloudflare Worker submission (mailto fallback) */
  const form = document.querySelector('#contact-form');
  if (form) {
    const status = document.querySelector('.form-status');
    const submitBtn = form.querySelector('.submit-btn');
    const setStatus = (text, isError) => {
      if (!status) return;
      status.textContent = text;
      status.style.color = isError ? '#ac3a24' : '#3a352c';
      status.classList.add('is-visible');
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = new FormData(form);
      const name = (data.get('name') || '').toString().trim();
      const company = (data.get('company') || '').toString().trim();
      const region = (data.get('region') || '').toString().trim();
      const email = (data.get('email') || '').toString().trim();
      const phone = (data.get('phone') || '').toString().trim();
      const message = (data.get('message') || '').toString().trim();

      if (!name || !region || !email || !message) {
        setStatus('Please fill in your name, region, email and message.', true);
        return;
      }

      const endpoint = form.getAttribute('data-endpoint');
      const site = form.getAttribute('data-site') || '';
      const mailto = form.getAttribute('data-mailto') || 'sales@petrolindustries.com';

      if (!endpoint) {
        const subject = encodeURIComponent(`FW26 B2B enquiry — ${company || name}`);
        const bodyLines = [
          `Name: ${name}`,
          company ? `Company: ${company}` : '',
          `Region: ${region}`,
          `Email: ${email}`,
          phone ? `Phone: ${phone}` : '',
          '',
          message
        ].filter(Boolean);
        window.location.href = `mailto:${mailto}?subject=${subject}&body=${encodeURIComponent(bodyLines.join('\n'))}`;
        setStatus('Opening your email client to send this message…', false);
        return;
      }

      if (submitBtn) submitBtn.disabled = true;
      setStatus('Sending…', false);

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, company, region, email, phone, message, site })
        });
        const result = await res.json();
        if (!res.ok || !result.ok) throw new Error(result.error || 'Send failed');
        setStatus("Thanks — your message has been sent. We'll be in touch soon.", false);
        form.reset();
      } catch (err) {
        setStatus('Something went wrong sending your message — please email us directly instead.', true);
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }
});

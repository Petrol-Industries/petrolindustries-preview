// PETROL INDUSTRIES — FW26 B2B Season Preview
document.addEventListener('DOMContentLoaded', () => {

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

  /* Contact form -> mailto handoff */
  const form = document.querySelector('#contact-form');
  if (form) {
    const status = document.querySelector('.form-status');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = new FormData(form);
      const name = (data.get('name') || '').toString().trim();
      const company = (data.get('company') || '').toString().trim();
      const email = (data.get('email') || '').toString().trim();
      const phone = (data.get('phone') || '').toString().trim();
      const message = (data.get('message') || '').toString().trim();

      if (!name || !email || !message) {
        if (status) {
          status.textContent = 'Please fill in your name, email and message.';
          status.style.color = '#ac3a24';
          status.classList.add('is-visible');
        }
        return;
      }

      const subject = encodeURIComponent(`FW26 B2B enquiry — ${company || name}`);
      const bodyLines = [
        `Name: ${name}`,
        company ? `Company: ${company}` : '',
        `Email: ${email}`,
        phone ? `Phone: ${phone}` : '',
        '',
        message
      ].filter(Boolean);
      const body = encodeURIComponent(bodyLines.join('\n'));
      const mailto = form.getAttribute('data-mailto') || 'sales@petrolindustries.com';
      window.location.href = `mailto:${mailto}?subject=${subject}&body=${body}`;

      if (status) {
        status.textContent = 'Opening your email client to send this message…';
        status.style.color = '#3a352c';
        status.classList.add('is-visible');
      }
    });
  }
});

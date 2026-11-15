/* Streamo — سكريبتات خفيفة بدون مكتبات */
'use strict';

/* ---------- شريط تقدّم التمرير + ظل الهيدر + زر الأعلى ---------- */
const header = document.querySelector('.header');
const progress = document.querySelector('.progress');
const topBtn = document.querySelector('.top-btn');

function onScroll() {
  const doc = document.documentElement;
  const max = doc.scrollHeight - doc.clientHeight;
  if (progress) progress.style.width = (max > 0 ? (doc.scrollTop / max) * 100 : 0) + '%';
  if (header) header.classList.toggle('scrolled', doc.scrollTop > 12);
  if (topBtn) topBtn.classList.toggle('show', doc.scrollTop > 420);
}
let ticking = false;
window.addEventListener('scroll', () => {
  if (!ticking) { requestAnimationFrame(() => { onScroll(); ticking = false; }); ticking = true; }
}, { passive: true });
onScroll();

if (topBtn) topBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

/* ---------- القائمة في الموبايل ---------- */
const burger = document.querySelector('.hamburger');
const mobileMenu = document.querySelector('.mobile-menu');
if (burger && mobileMenu) {
  burger.addEventListener('click', () => {
    const open = mobileMenu.classList.toggle('open');
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  mobileMenu.addEventListener('click', (e) => {
    if (e.target.tagName === 'A') mobileMenu.classList.remove('open');
  });
  document.addEventListener('click', (e) => {
    if (!mobileMenu.contains(e.target) && !burger.contains(e.target)) mobileMenu.classList.remove('open');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') mobileMenu.classList.remove('open');
  });
}

/* ---------- أكورديون الأسئلة الشائعة ---------- */
document.querySelectorAll('.faq-item').forEach((item) => {
  const btn = item.querySelector('.faq-q');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const willOpen = !item.classList.contains('open');
    document.querySelectorAll('.faq-item.open').forEach((o) => {
      o.classList.remove('open');
      o.querySelector('.faq-q').setAttribute('aria-expanded', 'false');
    });
    if (willOpen) {
      item.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
    }
  });
});

/* ---------- نسخ أوامر البحث ---------- */
document.querySelectorAll('.copy-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const box = btn.closest('.query-box');
    const code = box ? box.querySelector('code') : null;
    if (!code) return;
    const text = code.innerText.trim();
    const label = btn.querySelector('span');
    const original = label ? label.textContent : '';
    const doneText = btn.dataset.done || 'Copied';
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e2) { /* ignore */ }
      document.body.removeChild(ta);
    }
    if (label) {
      label.textContent = doneText;
      btn.classList.add('copied');
      setTimeout(() => { label.textContent = original; btn.classList.remove('copied'); }, 1700);
    }
  });
});

/* ---------- تمييز نسخة المنصة المناسبة للزائر ---------- */
(function markRecommended() {
  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);
  const isWindows = /Windows/i.test(ua);
  const pick = isAndroid ? '.dl-card[data-platform="android"]' : isWindows ? '.dl-card[data-platform="windows"]' : null;
  if (pick) { const el = document.querySelector(pick); if (el) el.classList.add('recommended'); }
})();

/* ---------- ظهور العناصر عند التمرير ---------- */
(function reveal() {
  const items = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      }
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  items.forEach((el) => io.observe(el));
  /* ضمان ظهور كل شيء حتى لو تأخر المراقب — لا محتوى مخفي أبدًا */
  window.addEventListener('load', () => {
    setTimeout(() => items.forEach((el) => el.classList.add('in')), 1500);
  });
})();

/* ---------- أزرار التحميل: تعبئة 0 → 100 ثم يبدأ التحميل ---------- */
(function downloadButtons() {
  const links = document.querySelectorAll('a[href*="github.com/X5Coder/Streamo/releases/download/"]');
  if (!links.length) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  links.forEach((a) => {
    /* غلاف داخلي للنص عشان mix-blend-mode يشتغل فوق التعبئة */
    const label = document.createElement('span');
    label.className = 'btn-label';
    while (a.firstChild) label.appendChild(a.firstChild);
    const fill = document.createElement('span');
    fill.className = 'btn-fill';
    fill.setAttribute('aria-hidden', 'true');
    const pct = document.createElement('span');
    pct.className = 'btn-pct';
    pct.textContent = '0%';
    label.appendChild(pct);
    a.appendChild(fill);
    a.appendChild(label);

    a.addEventListener('click', (e) => {
      if (a.classList.contains('is-loading')) { e.preventDefault(); return; }
      e.preventDefault();
      a.classList.add('is-loading');
      a.setAttribute('aria-busy', 'true');

      const start = performance.now();
      const dur = reduce ? 350 : 2300;
      function frame(now) {
        const t = Math.min((now - start) / dur, 1);
        const eased = 1 - Math.pow(2, -8 * t); /* easeOutExpo تقريبًا */
        const value = t >= 1 ? 100 : Math.round(Math.min(eased, 0.99) * 100);
        fill.style.width = value + '%';
        pct.textContent = value + '%';
        if (t < 1) {
          requestAnimationFrame(frame);
          return;
        }
        /* ابدأ التحميل الفعلي */
        fill.style.width = '100%';
        pct.textContent = '100%';
        const dl = document.createElement('a');
        dl.href = a.href;
        dl.rel = 'noopener';
        document.body.appendChild(dl);
        dl.click();
        dl.remove();
        window.setTimeout(() => {
          a.classList.remove('is-loading');
          a.removeAttribute('aria-busy');
          fill.style.width = '0%';
          pct.textContent = '0%';
        }, 750);
      }
      requestAnimationFrame(frame);
    });
  });
})();

/* ---------- السنة الحالية في الفوتر ---------- */
document.querySelectorAll('.js-year').forEach((el) => { el.textContent = new Date().getFullYear(); });

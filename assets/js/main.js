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

/* ---------- السنة الحالية في الفوتر ---------- */
document.querySelectorAll('.js-year').forEach((el) => { el.textContent = new Date().getFullYear(); });

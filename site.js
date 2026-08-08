/* mobile menu */
const burger = document.getElementById('navBurger'), pill = document.querySelector('.nav-pill');
if (burger) {
  burger.addEventListener('click', () => {
    const open = pill.classList.toggle('open');
    burger.setAttribute('aria-expanded', open);
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  });
  document.querySelectorAll('.nav-links a').forEach(a => a.addEventListener('click', () => {
    pill.classList.remove('open'); burger.setAttribute('aria-expanded', 'false');
  }));
}
/* reveal on scroll */
const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .14 });
document.querySelectorAll('.rv').forEach(el => io.observe(el));
/* count-up stats */
const cio = new IntersectionObserver(es => es.forEach(e => {
  if (!e.isIntersecting) return; cio.unobserve(e.target);
  const el = e.target, to = +el.dataset.to, t0 = performance.now(), dur = 1400;
  const step = t => { const p = Math.min((t - t0) / dur, 1), v = Math.round(to * (1 - Math.pow(1 - p, 3)));
    el.textContent = v.toLocaleString('en-IN'); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}), { threshold: .5 });
document.querySelectorAll('.count').forEach(el => cio.observe(el));
/* subtle magnetic buttons */
if (matchMedia('(hover:hover) and (prefers-reduced-motion:no-preference)').matches) {
  document.querySelectorAll('.btn').forEach(b => {
    b.addEventListener('mousemove', ev => { const r = b.getBoundingClientRect();
      b.style.transform = `translate(${(ev.clientX - r.left - r.width / 2) * .08}px,${(ev.clientY - r.top - r.height / 2) * .18 - 2}px)`; });
    b.addEventListener('mouseleave', () => { b.style.transform = ''; });
  });
}

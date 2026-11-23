/* Night flight — the route and the compass.
   The page works without this file: it only draws the route between the
   waypoints already in the markup, and lets the compass follow it. */

(() => {
  'use strict';

  const main = document.querySelector('main');
  const svg = document.querySelector('.route');
  if (!main || !svg || !svg.querySelector('.route__flown').getTotalLength) return;

  const plan = svg.querySelector('.route__plan');
  const flown = svg.querySelector('.route__flown');
  const destLeg = svg.querySelector('.route__dest');
  const craft = svg.querySelector('.route__craft');
  const needles = [...document.querySelectorAll('.needle')].map((el) => {
    const box = el.ownerSVGElement.viewBox.baseVal;
    return { el, cx: box.width / 2, cy: box.height / 2 };
  });
  const dial = document.querySelector('.dial');
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');

  const STEP = 5; // px between samples along the route
  const TURN = 30; // radius of a rounded turn

  let samples = []; // [{ x, y }] every STEP px of the flyable route
  let marks = []; // visible waypoints: { el, s }
  let total = 0;
  let mainTop = 0;

  let s = 0; // distance flown, px
  let sGoal = 0;
  let angle = 135; // needle, degrees
  let speed = 0;
  let bearing = 205; // heading of the leg under the craft
  let dialVisible = true;
  let drawn = -1; // distance last painted
  let frame = 0;
  let last = 0;
  let ready = false;

  /* ---- Geometry ---- */

  function measure() {
    const box = main.getBoundingClientRect();
    mainTop = box.top + window.scrollY;
    svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);

    const pts = [...main.querySelectorAll('[data-pt]')]
      .filter((el) => el.getClientRects().length)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          el,
          x: r.left - box.left + r.width / 2,
          y: r.top - box.top + r.height / 2,
          kind: el.dataset.pt,
        };
      });
    if (pts.length < 3) return;

    const dest = pts[pts.length - 1].kind === 'dest' ? pts.pop() : null;

    let d = `M${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      const next = pts[i + 1];
      if (p.kind === 'turn' && next) {
        const prev = pts[i - 1];
        const inLen = Math.hypot(p.x - prev.x, p.y - prev.y);
        const outLen = Math.hypot(next.x - p.x, next.y - p.y);
        const r = Math.min(TURN, inLen / 2, outLen / 2);
        const ax = p.x - ((p.x - prev.x) / inLen) * r;
        const ay = p.y - ((p.y - prev.y) / inLen) * r;
        const bx = p.x + ((next.x - p.x) / outLen) * r;
        const by = p.y + ((next.y - p.y) / outLen) * r;
        d += `L${ax} ${ay}Q${p.x} ${p.y} ${bx} ${by}`;
      } else {
        d += `L${p.x} ${p.y}`;
      }
    }
    plan.setAttribute('d', d);
    flown.setAttribute('d', d);

    const end = pts[pts.length - 1];
    destLeg.setAttribute('d', dest ? `M${end.x} ${end.y}L${dest.x} ${dest.y}` : '');

    total = flown.getTotalLength();
    samples = [];
    for (let l = 0; l <= total; l += STEP) samples.push(flown.getPointAtLength(l));
    samples.push(flown.getPointAtLength(total));

    marks = pts
      .filter((p) => p.el.classList.contains('wp'))
      .map((p) => ({ el: p.el, s: distanceAtY(p.y) }));

    ready = true;
    drawn = -1;
    svg.classList.add('is-live');
    aim();
    s = still.matches ? sGoal : Math.min(s, total);
    wake();
  }

  // The route only ever descends, so a height on the page maps to one distance along it.
  function distanceAtY(y) {
    let lo = 0;
    let hi = samples.length - 1;
    if (y <= samples[0].y) return 0;
    if (y >= samples[hi].y) return total;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (samples[mid].y <= y) lo = mid;
      else hi = mid;
    }
    const a = samples[lo];
    const b = samples[hi];
    const t = b.y === a.y ? 0 : (y - a.y) / (b.y - a.y);
    return Math.min(total, (lo + t) * STEP);
  }

  function pointAt(dist) {
    const i = Math.min(samples.length - 2, Math.max(0, Math.floor(dist / STEP)));
    const a = samples[i];
    const b = samples[i + 1];
    const t = Math.min(1, Math.max(0, dist / STEP - i));
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, dx: b.x - a.x, dy: b.y - a.y };
  }

  /* ---- Scroll: where the craft should be ---- */

  function aim() {
    if (!ready) return;
    const room = document.documentElement.scrollHeight - window.innerHeight;
    const progress = room > 0 ? Math.min(1, Math.max(0, window.scrollY / room)) : 0;
    // The craft sits a little above mid-screen, and reaches the end of the route at the bottom of the page.
    const eye = window.scrollY + window.innerHeight * (0.44 + 0.5 * progress ** 3);
    sGoal = distanceAtY(eye - mainTop);
  }

  /* ---- Drawing ---- */

  function draw() {
    if (s === drawn) return;
    drawn = s;
    const p = pointAt(s);
    flown.style.strokeDasharray = `${s.toFixed(1)} ${total + 10}`;
    craft.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
    craft.style.opacity = s > 1 ? 1 : 0;

    if (p.dx || p.dy) bearing = (Math.atan2(p.dx, -p.dy) * 180) / Math.PI;

    for (const w of marks) {
      const passed = w.s <= s + 2;
      if (w.el.classList.contains('is-passed') !== passed) w.el.classList.toggle('is-passed', passed);
    }
  }

  function turnNeedles() {
    for (const n of needles) n.el.setAttribute('transform', `rotate(${angle.toFixed(2)} ${n.cx} ${n.cy})`);
  }

  /* ---- One loop, asleep whenever nothing moves ---- */

  function tick(now) {
    frame = 0;
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;

    if (still.matches) {
      s = sGoal;
      draw();
      angle = bearing;
      turnNeedles();
      return;
    }

    const gap = sGoal - s;
    s = Math.abs(gap) < 0.4 ? sGoal : s + gap * Math.min(1, dt * 7);
    draw();

    // The needle is a damped spring: it swings past the new heading, then settles.
    // While the dial is on screen it also hunts by a degree or so, as a compass in flight does.
    const t = now / 1000;
    const hunt = dialVisible ? 1.3 * Math.sin(t * 0.83) + 0.7 * Math.sin(t * 2.1 + 1) : 0;
    let error = ((bearing + hunt - angle + 540) % 360) - 180;
    speed += (error * 52 - speed * 6.2) * dt;
    angle += speed * dt;
    turnNeedles();

    error = ((bearing - angle + 540) % 360) - 180;
    const moving = s !== sGoal || Math.abs(error) > 0.05 || Math.abs(speed) > 0.05;
    if (moving || (dialVisible && !document.hidden)) wake();
  }

  function wake() {
    if (!frame && ready) {
      if (!last || performance.now() - last > 200) last = performance.now();
      frame = requestAnimationFrame(tick);
    }
  }

  /* ---- Wiring ---- */

  window.addEventListener('scroll', () => { aim(); wake(); }, { passive: true });
  document.addEventListener('visibilitychange', wake);
  still.addEventListener('change', wake);

  let resizing = 0;
  const remeasure = () => {
    cancelAnimationFrame(resizing);
    resizing = requestAnimationFrame(measure);
  };
  window.addEventListener('resize', remeasure);
  window.addEventListener('load', remeasure);
  if ('ResizeObserver' in window) new ResizeObserver(remeasure).observe(main);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(remeasure);

  if (dial && 'IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      dialVisible = entry.isIntersecting;
      wake();
    }).observe(dial);
  }

  measure();
})();

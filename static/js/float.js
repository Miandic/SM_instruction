/* Лёгкий дрейф элементов радиального меню.
   Тот же приём, что на визитке (Miandic/index.html → driftIslands):
   у каждого элемента своя амплитуда, скорость и фаза синуса, текущее
   смещение догоняет цель через lerp, курсор рядом слегка притягивает.
   Луч тянется за своим кружком, чтобы связь не рвалась. */

/** Насколько быстро элемент догоняет свою цель (0..1 за кадр). */
const LERP = 0.035;
/** В этом радиусе (px) курсор притягивает элемент, максимум на PULL_MAX. */
const PULL_RADIUS = 200;
const PULL_MAX = 10;
/** Амплитуды рассчитаны на колесо шириной 520px — на узком экране меньше. */
const BASE_WIDTH = 520;

let raf = null;
let wheel = null;
let items = [];
let needMeasure = true;

const mouse = { x: 0, y: 0, inside: false };

const onMove = e => {
  // На тач-устройствах курсора нет: тап прислал бы одно событие, и ближайшие
  // лучи так и остались бы притянутыми к месту касания. Реагируем только на мышь.
  if (e.pointerType && e.pointerType !== 'mouse') return;
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  mouse.inside = true;
};
const onLeave = () => { mouse.inside = false; };
const onLayout = () => { needMeasure = true; };

export function startFloat(wheelEl) {
  stopFloat();
  if (!wheelEl) return;
  // уважаем системную настройку: анимации могут быть выключены намеренно
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  wheel = wheelEl;
  const k = Math.min(1, wheel.clientWidth / BASE_WIDTH);
  const lines = [...wheel.querySelectorAll('.wheel__lines line')];

  const make = (el, line, scale) => ({
    el,
    line,
    // луч знает свою «спокойную» точку, от неё и считаем смещение
    lineX: line ? Number(line.getAttribute('x2')) : 0,
    lineY: line ? Number(line.getAttribute('y2')) : 0,
    ampx: (7 + Math.random() * 5) * k * scale,
    ampy: (6 + Math.random() * 5) * k * scale,
    spx: 0.0004 + Math.random() * 0.0004,
    spy: 0.0004 + Math.random() * 0.0004,
    phx: Math.random() * 6.3,
    phy: Math.random() * 6.3,
    curx: 0, cury: 0, baseX: 0, baseY: 0,
  });

  items = [...wheel.querySelectorAll('.node')].map((el, i) => make(el, lines[i] ?? null, 1));

  const core = wheel.querySelector('.core');
  // центр — якорь композиции, ему хватает половины размаха
  if (core) items.push(make(core, null, 0.5));

  needMeasure = true;
  addEventListener('pointermove', onMove, { passive: true });
  addEventListener('pointerleave', onLeave, { passive: true });
  addEventListener('blur', onLeave);
  addEventListener('resize', onLayout, { passive: true });
  addEventListener('scroll', onLayout, { passive: true });

  raf = requestAnimationFrame(frame);
}

export function stopFloat() {
  cancelAnimationFrame(raf);
  raf = null;
  wheel = null;
  items = [];
  removeEventListener('pointermove', onMove);
  removeEventListener('pointerleave', onLeave);
  removeEventListener('blur', onLeave);
  removeEventListener('resize', onLayout);
  removeEventListener('scroll', onLayout);
}

/** Точка покоя каждого элемента на экране — от неё считаем расстояние до курсора. */
function measure() {
  for (const o of items) {
    const r = o.el.getBoundingClientRect();
    o.baseX = r.left + r.width / 2 - o.curx;
    o.baseY = r.top + r.height / 2 - o.cury;
  }
  needMeasure = false;
}

function frame(t) {
  // колесо пережило перерисовку или ушло с экрана — тихо выключаемся
  if (!wheel?.isConnected) { stopFloat(); return; }
  raf = requestAnimationFrame(frame);

  if (needMeasure) measure();
  // px → единицы viewBox (у svg он 100×100 на всю ширину колеса)
  const u = 100 / wheel.clientWidth;

  for (const o of items) {
    let tx = o.ampx * Math.sin(t * o.spx + o.phx);
    let ty = o.ampy * Math.sin(t * o.spy + o.phy);

    if (mouse.inside) {
      const vx = mouse.x - (o.baseX + tx);
      const vy = mouse.y - (o.baseY + ty);
      const d2 = vx * vx + vy * vy;
      if (d2 < PULL_RADIUS * PULL_RADIUS) {
        const d = Math.sqrt(d2) || 1;
        // у самого курсора притяжение гаснет, иначе элемент дрожит под ним
        const pull = PULL_MAX * (1 - d / PULL_RADIUS) * Math.min(d / 45, 1);
        tx += (vx / d) * pull;
        ty += (vy / d) * pull;
      }
    }

    o.curx += (tx - o.curx) * LERP;
    o.cury += (ty - o.cury) * LERP;
    // позиционирование живёт в свойстве translate, hover — в scale,
    // поэтому transform свободен под дрейф и ничего не перетирает
    o.el.style.transform = `translate(${o.curx.toFixed(2)}px, ${o.cury.toFixed(2)}px)`;

    if (o.line) {
      o.line.setAttribute('x2', (o.lineX + o.curx * u).toFixed(2));
      o.line.setAttribute('y2', (o.lineY + o.cury * u).toFixed(2));
    }
  }
}

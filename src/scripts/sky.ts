/**
 * The night sky behind the game: a sparse, slowly twinkling star field.
 * Deliberately cheap—one canvas, capped pixel ratio, pauses when hidden.
 */

interface Star {
  x: number;
  y: number;
  radius: number;
  phase: number;
  speed: number;
  brightness: number;
  warm: boolean;
  sparkle: boolean;
}

export interface SkyController {
  setMotion(enabled: boolean): void;
  refresh(): void;
}

export function initSky(canvas: HTMLCanvasElement, initialMotion = true): SkyController {
  const found = canvas.getContext('2d');
  if (!found) {
    return { setMotion: () => undefined, refresh: () => undefined };
  }
  const context: CanvasRenderingContext2D = found;

  let width = 0;
  let height = 0;
  let stars: Star[] = [];
  let motion = initialMotion;
  let frame = 0;
  let running = false;
  let pointerX = 0;
  let pointerY = 0;
  let lastTime = 0;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const canAnimate = (): boolean => motion && !reduced.matches;

  function resize(): void {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    createStars();
    draw(performance.now(), true);
  }

  function createStars(): void {
    const count = Math.min(230, Math.max(70, Math.round((width * height) / 14000)));
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      radius: Math.random() < 0.08 ? 1.4 + Math.random() * 1.1 : 0.25 + Math.random() * 0.95,
      phase: Math.random() * Math.PI * 2,
      speed: 0.00012 + Math.random() * 0.00045,
      brightness: 0.16 + Math.random() * 0.55,
      warm: Math.random() < 0.38,
      sparkle: Math.random() < 0.05,
    }));
  }

  function draw(time: number, still = false): void {
    context.clearRect(0, 0, width, height);
    const offsetX = pointerX * 7;
    const offsetY = pointerY * 7;

    for (const star of stars) {
      const twinkle = still || !canAnimate()
        ? 0.72
        : 0.55 + Math.sin(time * star.speed + star.phase) * 0.42;
      const alpha = Math.max(0.04, Math.min(1, star.brightness * twinkle));
      const x = star.x + offsetX * (star.radius * 0.6);
      const y = star.y + offsetY * (star.radius * 0.6);

      context.beginPath();
      context.arc(x, y, star.radius, 0, Math.PI * 2);
      context.fillStyle = star.warm
        ? `rgba(255, 228, 184, ${alpha})`
        : `rgba(204, 219, 255, ${alpha})`;
      context.fill();

      if (star.sparkle) {
        const length = star.radius * 5;
        const gradient = context.createLinearGradient(x - length, y, x + length, y);
        gradient.addColorStop(0, 'rgba(255, 232, 190, 0)');
        gradient.addColorStop(0.5, `rgba(255, 232, 190, ${alpha * 0.55})`);
        gradient.addColorStop(1, 'rgba(255, 232, 190, 0)');
        context.strokeStyle = gradient;
        context.lineWidth = 0.7;
        context.beginPath();
        context.moveTo(x - length, y);
        context.lineTo(x + length, y);
        context.moveTo(x, y - length);
        context.lineTo(x, y + length);
        context.stroke();
      }
    }
  }

  function loop(time: number): void {
    if (!running) return;
    frame = requestAnimationFrame(loop);
    if (time - lastTime < 32) return;
    lastTime = time;
    draw(time);
  }

  function start(): void {
    if (running) return;
    if (!canAnimate()) {
      draw(performance.now(), true);
      return;
    }
    running = true;
    frame = requestAnimationFrame(loop);
  }

  function stop(): void {
    running = false;
    cancelAnimationFrame(frame);
  }

  function sync(): void {
    stop();
    if (document.hidden) return;
    start();
  }

  function onPointerMove(event: PointerEvent): void {
    pointerX = (event.clientX / Math.max(1, width) - 0.5) * 2;
    pointerY = (event.clientY / Math.max(1, height) - 0.5) * 2;
  }

  const onResize = (): void => resize();
  const onVisibility = (): void => sync();
  const onReduced = (): void => sync();

  window.addEventListener('resize', onResize);
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  reduced.addEventListener('change', onReduced);

  resize();
  sync();

  return {
    setMotion(enabled: boolean): void {
      motion = enabled;
      sync();
    },
    refresh(): void {
      resize();
      sync();
    },
  };
}

// Electric Azure / white tones for the celebration on the matte black bg.
const CELEBRATION_COLORS = ["#3B82F6", "#60A5FA", "#ffffff", "#93C5FD", "#2563EB"];

/** Sustained fireworks from both edges of the screen - for finishing the deck. */
export async function fireCelebration() {
  const { default: confetti } = await import("canvas-confetti");
  const durationMs = 3000;
  const end = Date.now() + durationMs;

  function frame() {
    confetti({
      particleCount: 4,
      angle: 60,
      spread: 55,
      origin: { x: 0, y: 0.7 },
      colors: CELEBRATION_COLORS,
      disableForReducedMotion: true,
    });
    confetti({
      particleCount: 4,
      angle: 120,
      spread: 55,
      origin: { x: 1, y: 0.7 },
      colors: CELEBRATION_COLORS,
      disableForReducedMotion: true,
    });

    if (Date.now() < end) {
      requestAnimationFrame(frame);
    }
  }

  frame();
}

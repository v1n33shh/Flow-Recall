// Gold/white tones for the "Black Card" celebration on the matte black bg.
const CELEBRATION_COLORS = ["#D4AF37", "#ffffff", "#E8C766", "#F5E6C8", "#B8860B"];

/** Small burst from the bottom of the screen - for a single Level 3 correct answer. */
export async function fireSmallBurst() {
  const { default: confetti } = await import("canvas-confetti");
  confetti({
    particleCount: 40,
    angle: 90,
    spread: 60,
    startVelocity: 45,
    origin: { x: 0.5, y: 1 },
    colors: CELEBRATION_COLORS,
    disableForReducedMotion: true,
  });
}

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

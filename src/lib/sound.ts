// Placeholder sound module — put recorded .mp3 files in public/sounds/
// All play() calls are fire-and-forget; missing files fail silently.

const cache = new Map<string, HTMLAudioElement>();

function playSound(file: string): void {
  if (!cache.has(file)) {
    cache.set(file, new Audio(`/sounds/${file}`));
  }
  (cache.get(file)!.cloneNode() as HTMLAudioElement).play().catch(() => {});
}

export const sound = {
  tileDraw:        () => playSound("tile-draw.mp3"),
  tilePickup:      () => playSound("tile-pickup.mp3"),
  tilePlaceFirst:  () => playSound("tile-place-first.mp3"),
  tileSnap:        () => playSound("tile-snap.mp3"),
  tilePlace:       () => playSound("tile-place.mp3"),
  scorePips:       () => playSound("score-pips.mp3"),
  scoreMultiplier: () => playSound("score-multiplier.mp3"),
};

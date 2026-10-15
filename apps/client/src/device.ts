/**
 * Whether this is a phone: a touch screen whose short side is under 600 pixels (tablets are bigger,
 * and a desktop browser window squeezed narrow still has a mouse and a big screen). Phones are not
 * supported yet, so they are shown a notice instead of the game.
 */
export function isPhone(): boolean {
  if (typeof matchMedia === 'undefined' || typeof screen === 'undefined') return false;
  return matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
}

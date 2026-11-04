/**
 * The waiting-room display writes white text on the clinic's accent colour. A colour the clinic chooses is used only when
 * that text stays readable from across a room (the WCAG contrast ratio of white on it is at least 4.5); otherwise the screen
 * keeps its own colour, so a branding choice can never make the number hard to read.
 */
const HEX = /^#[0-9a-f]{6}$/i;

function channel(value: number): number {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** The contrast ratio of white text on this colour (1 to 21); 0 for anything that is not `#RRGGBB`. */
export function contrastWithWhite(hex: string): number {
  if (!HEX.test(hex)) return 0;
  const r = channel(parseInt(hex.slice(1, 3), 16));
  const g = channel(parseInt(hex.slice(3, 5), 16));
  const b = channel(parseInt(hex.slice(5, 7), 16));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (luminance + 0.05);
}

export const MIN_ACCENT_CONTRAST = 4.5;

/** The colour to use, or undefined when none was chosen or it would be hard to read. */
export function readableAccent(hex: string | null | undefined): string | undefined {
  return hex && contrastWithWhite(hex) >= MIN_ACCENT_CONTRAST ? hex : undefined;
}

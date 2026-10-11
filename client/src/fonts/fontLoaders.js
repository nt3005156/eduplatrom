// Fonts are served from this app's own origin (no Google Fonts). Each admin-selectable family is a separate
// chunk that loads only when an admin selects it. Fraunces, Inter and JetBrains Mono are bundled in main.jsx.
// Noto Sans Devanagari is always bundled, so Nepali (Devanagari) text does not depend on the device's fonts.

export const FONT_LOADERS = {
  'Poppins': () => Promise.all([import('@fontsource/poppins/400.css'), import('@fontsource/poppins/500.css'), import('@fontsource/poppins/600.css'), import('@fontsource/poppins/700.css')]),
  'Playfair Display': () => Promise.all([import('@fontsource/playfair-display/400.css'), import('@fontsource/playfair-display/500.css'), import('@fontsource/playfair-display/600.css'), import('@fontsource/playfair-display/700.css')]),
  'Space Grotesk': () => Promise.all([import('@fontsource/space-grotesk/400.css'), import('@fontsource/space-grotesk/500.css'), import('@fontsource/space-grotesk/600.css'), import('@fontsource/space-grotesk/700.css')]),
  'Roboto': () => Promise.all([import('@fontsource/roboto/400.css'), import('@fontsource/roboto/500.css'), import('@fontsource/roboto/600.css'), import('@fontsource/roboto/700.css')]),
  'Open Sans': () => Promise.all([import('@fontsource/open-sans/400.css'), import('@fontsource/open-sans/500.css'), import('@fontsource/open-sans/600.css'), import('@fontsource/open-sans/700.css')]),
  'Nunito': () => Promise.all([import('@fontsource/nunito/400.css'), import('@fontsource/nunito/500.css'), import('@fontsource/nunito/600.css'), import('@fontsource/nunito/700.css')]),
  'Lato': () => Promise.all([import('@fontsource/lato/400.css'), import('@fontsource/lato/700.css')]),
};

export function loadFontFamily(family) {
  const load = FONT_LOADERS[family];
  return load ? load() : Promise.resolve(null);
}

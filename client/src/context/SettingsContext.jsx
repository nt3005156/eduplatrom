import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { loadFontFamily } from '../fonts/fontLoaders.js';
import api from '../api/client.js';
import { useAuth } from './AuthContext.jsx';

const SettingsContext = createContext(null);

const DEFAULTS = {
  site_name: 'NITEX',
  tagline: 'Learn. Practice. Excel.',
  logo_url: null,
  favicon_url: null,
  hero_image_url: null,
  primary_color: '#FFB454',
  accent_color: '#5EEAD4',
  font_family: 'Fraunces',
  body_font: 'Inter',
  ui_density: 'comfortable',
  corner_style: 'rounded',
  default_theme: 'dark',
  footer_about: '',
  contact_email: '',
  contact_phone: '',
  address: '',
  social_facebook: '',
  social_twitter: '',
  social_instagram: '',
  social_youtube: '',
  social_linkedin: '',
};

// Google Fonts admins can pick from for headings vs body text.
// Kept to a small curated set so we only ever lazy-load what's actually selected.
export const HEADING_FONT_OPTIONS = ['Fraunces', 'Poppins', 'Playfair Display', 'Space Grotesk', 'Inter'];
export const BODY_FONT_OPTIONS = ['Inter', 'Roboto', 'Open Sans', 'Nunito', 'Lato'];

const loadedFonts = new Set(['Fraunces', 'Inter']); // bundled in main.jsx
function ensureFontLoaded(family) {
  if (!family || loadedFonts.has(family)) return;
  loadedFonts.add(family);
  loadFontFamily(family).catch(() => loadedFonts.delete(family));
}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  return m ? `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}` : '255, 180, 84';
}

export function SettingsProvider({ children }) {
  const { user } = useAuth();
  const [settings, setSettings] = useState(DEFAULTS);
  const [theme, setThemeState] = useState(() => localStorage.getItem('nitex_theme') || 'dark');
  const [loaded, setLoaded] = useState(false);

  const loadSettings = useCallback(() => {
    api.get('/settings').then(({ data }) => {
      setSettings({ ...DEFAULTS, ...data.settings });
      setLoaded(true);
      // Only auto-apply the site default theme if the user has never chosen one locally
      if (!localStorage.getItem('nitex_theme') && !user) {
        setThemeState(data.settings.default_theme || 'dark');
      }
    }).catch(() => setLoaded(true));
  }, [user]);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  // Sync theme with logged-in user's saved preference on first load after login
  useEffect(() => {
    if (user?.theme_preference && !localStorage.getItem('nitex_theme')) {
      setThemeState(user.theme_preference);
    }
  }, [user]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('nitex_theme', theme);
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--brand-primary', settings.primary_color);
    root.style.setProperty('--brand-primary-rgb', hexToRgb(settings.primary_color));
    root.style.setProperty('--brand-accent', settings.accent_color);

    // Typography: lazy-load any non-default Google Font, then apply as CSS vars
    ensureFontLoaded(settings.font_family);
    ensureFontLoaded(settings.body_font);
    root.style.setProperty('--font-heading', `'${settings.font_family || 'Fraunces'}', 'Inter', serif`);
    root.style.setProperty('--font-body', `'${settings.body_font || 'Inter'}', system-ui, -apple-system, sans-serif`);

    // Layout density
    if (settings.ui_density === 'compact') {
      root.style.setProperty('--density-pad', '14px');
      root.style.setProperty('--density-pad-sm', '10px');
    } else {
      root.style.setProperty('--density-pad', '22px');
      root.style.setProperty('--density-pad-sm', '14px');
    }

    // Corner style (rounded vs sharp)
    root.setAttribute('data-corners', settings.corner_style === 'sharp' ? 'sharp' : 'rounded');

    if (settings.favicon_url) {
      let link = document.querySelector("link[rel='icon']");
      if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
      link.href = settings.favicon_url;
    }
    if (settings.site_name) document.title = `${settings.site_name} — ${settings.tagline || 'Learn. Practice. Excel.'}`;
  }, [settings]);

  const toggleTheme = () => setThemeState(t => {
    const next = t === 'light' ? 'dark' : 'light';
    if (user) api.put('/settings/theme', { theme: next }).catch(() => {});
    return next;
  });

  return (
    <SettingsContext.Provider value={{ settings, loaded, theme, toggleTheme, refreshSettings: loadSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export const useSettings = () => useContext(SettingsContext);

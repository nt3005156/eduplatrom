import { useSettings } from '../context/SettingsContext.jsx';
import { FacebookIcon, TwitterIcon, InstagramIcon, YoutubeIcon, LinkedinIcon } from './SocialIcons.jsx';

const SOCIALS = [
  ['social_facebook', FacebookIcon],
  ['social_twitter', TwitterIcon],
  ['social_instagram', InstagramIcon],
  ['social_youtube', YoutubeIcon],
  ['social_linkedin', LinkedinIcon],
];

/**
 * Minimal footer: just social links + copyright, no space-hungry columns.
 * Kept intentionally compact per product requirements — do not re-add the
 * multi-column about/links/contact layout here.
 */
export default function Footer() {
  const { settings } = useSettings();
  if (!settings) return null;
  const activeSocials = SOCIALS.filter(([key]) => settings[key]);
  const year = new Date().getFullYear();

  return (
    <footer className="app-footer" style={{ borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
      <div
        className="flex items-center justify-between"
        style={{ maxWidth: 1400, margin: '0 auto', padding: '12px 32px', flexWrap: 'wrap', gap: 10 }}
      >
        <span className="text-xs text-dim">© {year} {settings.site_name}. All Rights Reserved.</span>
        {activeSocials.length > 0 && (
          <div className="flex gap-2">
            {activeSocials.map(([key, Icon]) => (
              <a
                key={key}
                href={settings[key]}
                target="_blank"
                rel="noreferrer"
                className="btn-ghost"
                style={{ width: 28, height: 28, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)' }}
                aria-label={key.replace('social_', '')}
              >
                <Icon />
              </a>
            ))}
          </div>
        )}
      </div>
    </footer>
  );
}

import { useSettings } from '../context/SettingsContext.jsx';
import { FacebookIcon, TwitterIcon, InstagramIcon, YoutubeIcon, LinkedinIcon } from './SocialIcons.jsx';

const SOCIALS = [
  ['social_facebook', FacebookIcon],
  ['social_twitter', TwitterIcon],
  ['social_instagram', InstagramIcon],
  ['social_youtube', YoutubeIcon],
  ['social_linkedin', LinkedinIcon],
];

/** A compact footer for the full-screen auth pages (login/register) where the full multi-column Footer would look out of place. */
export default function AuthFooterStrip() {
  const { settings } = useSettings();
  if (!settings) return null;
  const activeSocials = SOCIALS.filter(([key]) => settings[key]);

  return (
    <div className="flex-col items-center gap-2" style={{ marginTop: 28, textAlign: 'center' }}>
      {activeSocials.length > 0 && (
        <div className="flex gap-2" style={{ justifyContent: 'center' }}>
          {activeSocials.map(([key, Icon]) => (
            <a key={key} href={settings[key]} target="_blank" rel="noreferrer" className="btn-ghost" style={{ width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)' }}>
              <Icon />
            </a>
          ))}
        </div>
      )}
      <div className="text-xs text-dim">© {new Date().getFullYear()} {settings.site_name}. All rights reserved.</div>
    </div>
  );
}

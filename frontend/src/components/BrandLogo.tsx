import './brand-logo.css';

/** Tone follows the actual surface; public/login/PWA surfaces stay dark. */
export function BrandLogo({ tone = 'auto' }: { tone?: 'auto' | 'light-surface' | 'dark-surface' }) {
  return <picture className="sms-brand-logo" data-tone={tone}>
    <img className="sms-brand-logo__light" src="/brand/sms-logo-horizontal.webp" width={246} height={96} alt="SMS Security Management System" />
    <img className="sms-brand-logo__dark" src="/brand/sms-logo-horizontal-dark.webp" width={248} height={96} alt="SMS Security Management System" />
  </picture>;
}

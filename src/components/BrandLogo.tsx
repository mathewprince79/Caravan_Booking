import { useState } from 'react';

// Versioned so a cached copy can never shadow a new upload.
const LOGO_SRC = '/logo.png?v=2';

/**
 * Uses public/logo.png when it is present. Until that file is added the vector
 * recreation below keeps the brand on screen instead of a broken image.
 */
export default function BrandLogo({ compact = false }: { compact?: boolean }) {
  const [imageFailed, setImageFailed] = useState(false);

  if (!imageFailed) {
    return (
      <img
        src={LOGO_SRC}
        alt="BookToUse Club"
        className={compact ? 'brand-logo brand-logo-compact' : 'brand-logo'}
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <span
      className={compact ? 'brand-logo brand-logo-fallback brand-logo-compact' : 'brand-logo brand-logo-fallback'}
      role="img"
      aria-label="BookToUse Club"
    >
      <LogoMark />
      <span className="brand-logo-word">
        <span className="brand-logo-book">Book</span>
        <span className="brand-logo-touse">touse</span>
        <span className="brand-logo-com">.com</span>
      </span>
    </span>
  );
}

function LogoMark() {
  return (
    <svg className="brand-logo-mark" viewBox="0 0 72 72" aria-hidden="true">
      <rect x="6" y="14" width="60" height="52" rx="15" fill="#0b2b5e" />
      <rect x="15" y="8" width="9" height="15" rx="4.5" fill="#22d3ee" />
      <rect x="48" y="8" width="9" height="15" rx="4.5" fill="#22d3ee" />
      <rect x="16" y="25" width="40" height="33" rx="9" fill="#f8fafc" />
      <g fill="#38bdf8">
        <rect x="21" y="30" width="5" height="5" rx="1.5" />
        <rect x="29" y="30" width="5" height="5" rx="1.5" />
        <rect x="37" y="30" width="5" height="5" rx="1.5" />
        <rect x="21" y="38" width="5" height="5" rx="1.5" />
        <rect x="29" y="38" width="5" height="5" rx="1.5" />
      </g>
      <path d="M34 47l6 6 12-13" stroke="#f97316" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

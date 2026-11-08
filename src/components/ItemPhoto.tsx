import { mediaUrl } from '../lib/api';

export default function ItemPhoto({ photoKey, name }: { photoKey: string | null; name: string }) {
  const url = mediaUrl(photoKey);
  if (!url) {
    return (
      <div className="item-photo-placeholder">
        <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 15h18M5 15V9a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6" strokeLinecap="round" />
          <circle cx="7.5" cy="17.5" r="1.6" />
          <circle cx="16.5" cy="17.5" r="1.6" />
        </svg>
        <span>No photo yet</span>
      </div>
    );
  }
  return <img src={url} alt={name} loading="lazy" />;
}

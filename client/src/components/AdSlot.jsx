// Placeholder ad slot ready for Google AdSense integration.
// To go live: add the AdSense script tag to index.html with your publisher ID,
// then replace the placeholder <ins> block below with your real <ins class="adsbygoogle">
// unit and call (window.adsbygoogle = window.adsbygoogle || []).push({}) on mount.
export default function AdSlot({ label = 'Advertisement', style }) {
  return (
    <div
      style={{
        border: '1.5px dashed var(--border)', borderRadius: 14, padding: '18px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-dim)', fontSize: 12, letterSpacing: '.04em', textTransform: 'uppercase',
        background: 'repeating-linear-gradient(45deg, #fafafe, #fafafe 10px, #f3f3fb 10px, #f3f3fb 20px)',
        minHeight: 90, ...style,
      }}
      data-ad-slot-placeholder="true"
    >
      {label} · Space reserved for Google AdSense
    </div>
  );
}

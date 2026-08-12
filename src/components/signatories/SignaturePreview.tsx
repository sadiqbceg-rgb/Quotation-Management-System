import { toDataUri, type Base64Png } from '@shared/signature';

export interface SignaturePreviewProps {
  image: Base64Png;
  /** Describes whose signature this is, for a screen reader. */
  personName: string;
  className?: string;
}

/**
 * Render a signature image.
 *
 * The checkerboard is the point: a signature must have a transparent
 * background, and against plain white an opaque PNG looks identical to a
 * correct one. On this backdrop the white box is immediately visible, which is
 * the only way an Admin catches the problem before it reaches a client.
 *
 * `toDataUri` is called here and only here — the boundary where base64 becomes
 * something the browser renders. Nothing upstream holds a URL-shaped string.
 */
export function SignaturePreview({ image, personName, className }: SignaturePreviewProps) {
  return (
    <div
      className={`inline-block rounded border border-slate-200 p-2 ${className ?? ''}`}
      style={{
        backgroundColor: '#ffffff',
        backgroundImage:
          'linear-gradient(45deg, #e2e8f0 25%, transparent 25%), linear-gradient(-45deg, #e2e8f0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e2e8f0 75%), linear-gradient(-45deg, transparent 75%, #e2e8f0 75%)',
        backgroundSize: '12px 12px',
        backgroundPosition: '0 0, 0 6px, 6px -6px, -6px 0',
      }}
    >
      <img
        src={toDataUri(image)}
        alt={`Signature of ${personName}`}
        className="block max-h-24 w-auto max-w-full"
      />
    </div>
  );
}

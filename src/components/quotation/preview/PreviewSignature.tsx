import { BODY_BOX, COLORS, SIGNATURE_BLOCK, TYPOGRAPHY } from '@/config/document-layout';
import type { ImageRef } from '@/services/document/document-model.types';

export interface PreviewSignatureProps {
  left: readonly string[];
  sealImage: ImageRef;
  signatureImage: ImageRef;
}

/**
 * The signature block.
 *
 * The approved layout (§2.4): the six detail lines run down the LEFT from
 * x 34, and BOTH the seal (upper) and the signature image (lower) sit on the
 * RIGHT. PRD §25 describes it the other way round; the approved document is
 * authoritative and PRD §25's binding requirement — the seal on the right — is
 * satisfied. See §26 UR-05.
 *
 * Positioned absolutely from the measured rects rather than flowed, because the
 * seal and the signature overlap vertically in a way normal flow cannot express,
 * and because the non-overlap guarantee in PRD §25 is a property of those exact
 * coordinates. `signatureRects()` asserts it numerically in the tests.
 *
 * The block is marked `keep-together` so print never splits it.
 */
export function PreviewSignature({ left, sealImage, signatureImage }: PreviewSignatureProps) {
  const relativeX = (absoluteX: number): number => absoluteX - BODY_BOX.leftPt;

  const seal = SIGNATURE_BLOCK.sealRect;
  const signature = SIGNATURE_BLOCK.signatureRect;

  // Heights are relative to the block's own top, which starts at the seal.
  const blockTop = Math.min(seal.y0, SIGNATURE_BLOCK.detailsFirstLineYPt);

  return (
    <div
      className="keep-together"
      style={{
        position: 'relative',
        height: `${String(SIGNATURE_BLOCK.reservedHeightPt)}pt`,
        marginTop: `${String(TYPOGRAPHY.paragraphSpaceAfterPt)}pt`,
      }}
    >
      {/* Details, left column */}
      <div
        style={{
          position: 'absolute',
          left: `${String(relativeX(SIGNATURE_BLOCK.detailsXPt))}pt`,
          top: `${String(SIGNATURE_BLOCK.detailsFirstLineYPt - blockTop)}pt`,
          // Bounded by the seal's left edge, so a long job title can never run
          // underneath it — the structural half of the no-overlap guarantee.
          maxWidth: `${String(seal.x0 - SIGNATURE_BLOCK.detailsXPt)}pt`,
        }}
      >
        {left.map((line, index) => (
          <div
            key={line}
            style={{
              lineHeight: `${String(SIGNATURE_BLOCK.detailsLinePitchPt)}pt`,
              fontWeight: 700,
              // The company name is navy in the approved document; the email is
              // the hyperlink blue. Both sampled, both from COLORS.
              color:
                index === 2 ? COLORS.navy : line.startsWith('Email:') ? COLORS.linkBlue : COLORS.text,
              textDecoration: line.startsWith('Email:') ? 'underline' : undefined,
            }}
          >
            {line}
          </div>
        ))}
      </div>

      {/* Seal, upper right */}
      {sealImage.src.length > 0 ? (
        <img
          src={sealImage.src}
          alt={sealImage.alt}
          style={{
            position: 'absolute',
            left: `${String(relativeX(seal.x0))}pt`,
            top: `${String(seal.y0 - blockTop)}pt`,
            width: `${String(seal.x1 - seal.x0)}pt`,
            height: `${String(seal.y1 - seal.y0)}pt`,
            objectFit: 'contain',
          }}
        />
      ) : null}

      {/* Signature, lower right */}
      {signatureImage.src.length > 0 ? (
        <img
          src={signatureImage.src}
          alt={signatureImage.alt}
          style={{
            position: 'absolute',
            left: `${String(relativeX(signature.x0))}pt`,
            top: `${String(signature.y0 - blockTop)}pt`,
            width: `${String(signature.x1 - signature.x0)}pt`,
            height: `${String(signature.y1 - signature.y0)}pt`,
            objectFit: 'contain',
          }}
        />
      ) : null}

      {/* The printed rule the signature sits against */}
      <div
        style={{
          position: 'absolute',
          left: `${String(relativeX(SIGNATURE_BLOCK.signatureLabelXPt))}pt`,
          top: `${String(SIGNATURE_BLOCK.signatureLabelYPt - blockTop)}pt`,
          whiteSpace: 'nowrap',
        }}
      >
        Signature:______________
      </div>
    </div>
  );
}

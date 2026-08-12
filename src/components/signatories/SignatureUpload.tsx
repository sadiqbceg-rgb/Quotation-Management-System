import { useRef, useState } from 'react';

import { Button } from '@/components/common/Button';
import { Field } from '@/components/common/Field';
import { readPngHeader, sanitizeFilename, type PngHeader } from '@shared/png';
import { base64Png, type Base64Png } from '@shared/signature';
import { UPLOAD_LIMITS } from '@shared/validation-rules';
import { SignaturePreview } from './SignaturePreview';

export interface SignatureUploadValue {
  signature: Base64Png;
  filename: string;
  header: PngHeader;
}

export interface SignatureUploadProps {
  personName: string;
  isUploading: boolean;
  /** A server-side failure. The chosen file is kept so retry costs nothing. */
  error?: string | null;
  onUpload: (value: SignatureUploadValue) => void;
}

/** Read a File as bare base64, with the `data:` prefix stripped. */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => {
      reject(new Error('The file could not be read.'));
    };
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

function bytesOf(base64: string): number[] {
  const binary = atob(base64);
  const bytes: number[] = [];
  for (let index = 0; index < binary.length; index++) bytes.push(binary.charCodeAt(index));
  return bytes;
}

/**
 * Choose and upload a signature image. Admin only.
 *
 * The file is inspected in the browser with the SAME header reader the server
 * uses, so the preview cannot promise something the server will reject, and the
 * user learns about a wrong format or a missing alpha channel immediately
 * rather than after a round trip.
 *
 * The browser check is a convenience. The server re-reads the bytes and is the
 * control — this component's verdict is never trusted.
 */
export function SignatureUpload({
  personName,
  isUploading,
  error = null,
  onUpload,
}: SignatureUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const [selected, setSelected] = useState<SignatureUploadValue | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const maxKb = Math.floor(UPLOAD_LIMITS.signatureMaxBytes / 1024);

  const choose = async (file: File): Promise<void> => {
    setLocalError(null);
    setSelected(null);

    if (file.size > UPLOAD_LIMITS.signatureMaxBytes) {
      setLocalError(`That file is ${String(Math.round(file.size / 1024))} KB. The limit is ${String(maxKb)} KB.`);
      return;
    }

    let base64: string;
    try {
      base64 = await readAsBase64(file);
    } catch {
      setLocalError('That file could not be read.');
      return;
    }

    const header = readPngHeader(bytesOf(base64));
    if (header === null) {
      // Catches the common case exactly: a JPEG saved with a .png extension.
      setLocalError('That is not a PNG image. Export the signature as a PNG with a transparent background.');
      return;
    }

    setSelected({ signature: base64Png(base64), filename: sanitizeFilename(file.name), header });
  };

  return (
    <div className="flex flex-col gap-3">
      <Field
        label="Signature image"
        hint={`PNG with a transparent background, at least 600 px wide, up to ${String(maxKb)} KB. Ink only, cropped close.`}
        {...(localError === null ? {} : { error: localError })}
      >
        {({ id, invalid, describedBy }) => (
          <input
            ref={inputRef}
            id={id}
            type="file"
            accept="image/png"
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-800 hover:file:bg-slate-50"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) void choose(file);
            }}
          />
        )}
      </Field>

      {selected !== null ? (
        <div className="flex flex-col gap-2">
          <SignaturePreview image={selected.signature} personName={personName} />

          <p className="text-xs text-slate-500">
            {selected.header.width} × {selected.header.height} px
            {selected.header.hasAlpha ? ' · transparent background' : ''}
          </p>

          {selected.header.hasAlpha ? null : (
            <p role="status" className="text-xs text-amber-700">
              This PNG has no transparent background. It will print as a white box over the
              letterhead. Re-export it with transparency before using it on a quotation.
            </p>
          )}

          {selected.header.width < 600 ? (
            <p role="status" className="text-xs text-amber-700">
              This image is {selected.header.width} px wide. At least 600 px is recommended, or the
              signature may look soft in the PDF.
            </p>
          ) : null}
        </div>
      ) : null}

      {error !== null ? (
        <p role="alert" className="text-brand-red text-sm">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={selected === null}
          isLoading={isUploading}
          onClick={() => {
            if (selected !== null) onUpload(selected);
          }}
        >
          Upload signature
        </Button>
      </div>
    </div>
  );
}

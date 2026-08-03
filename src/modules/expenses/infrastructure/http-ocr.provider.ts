import { Inject, Injectable, Logger } from '@nestjs/common';

import { ENV_TOKEN } from '../../../config/config.module';
import type { Env } from '../../../config/env';
import { OcrProvider, type OcrResult, type OcrSuggestion } from '../domain/ocr.provider';

const FAILED: OcrResult = { status: 'failed', suggestion: null, blocks: [] };

/** Talks to the Python OCR service over the compose network. */
@Injectable()
export class HttpOcrProvider extends OcrProvider {
  private readonly log = new Logger(HttpOcrProvider.name);

  constructor(@Inject(ENV_TOKEN) private readonly env: Env) {
    super();
  }

  async extract(buffer: Buffer, filename: string): Promise<OcrResult> {
    // One retry: the OCR service is a single container, and a restart or a cold
    // model load can drop exactly one request.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.call(buffer, filename);
      } catch (err) {
        this.log.warn(`OCR attempt ${attempt + 1} failed: ${(err as Error).message}`);
      }
    }
    // Deliberately not an exception: a scan failure must not block the user
    // from recording the expense by hand.
    return FAILED;
  }

  private async call(buffer: Buffer, filename: string): Promise<OcrResult> {
    const form = new FormData();
    // Copy into a plain Uint8Array: a Buffer's backing store is typed as
    // ArrayBufferLike, which Blob's signature does not accept.
    form.append('file', new Blob([new Uint8Array(buffer)]), filename);

    const res = await fetch(`${this.env.OCR_SERVICE_URL}/extract`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(this.env.OCR_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`ocr service responded ${res.status}`);

    const body = (await res.json()) as { blocks: unknown[]; suggestion: OcrSuggestion };
    return { status: 'done', suggestion: body.suggestion, blocks: body.blocks };
  }
}

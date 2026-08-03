/**
 * Port: receipt OCR.
 *
 * The only implementation talks HTTP to the Python service, but the abstraction
 * keeps that dependency out of the application layer and lets the unit and e2e
 * suites run without a Python process.
 */

export type OcrField = 'amount' | 'taxAmount' | 'date' | 'merchantName';

export type OcrConfidence = Record<OcrField, number>;

export type OcrSuggestion = {
  amount: number | null;
  taxAmount: number | null;
  /** ISO date, `YYYY-MM-DD`. */
  date: string | null;
  merchantName: string | null;
  confidence: OcrConfidence;
};

export type OcrResult =
  | { status: 'done'; suggestion: OcrSuggestion; blocks: unknown[] }
  | { status: 'failed'; suggestion: null; blocks: [] };

export abstract class OcrProvider {
  /**
   * Never throws: an OCR failure returns `status: 'failed'` so that scanning
   * stays an optional assist and can never block recording an expense.
   */
  abstract extract(buffer: Buffer, filename: string): Promise<OcrResult>;
}

import * as path from 'node:path';

/**
 * Arabic-capable fonts for pdfkit documents.
 *
 * pdfkit's built-in Helvetica has no Arabic glyphs; embedded TTFs go through
 * fontkit, which applies the OpenType shaping (init/medi/fina forms) Arabic
 * needs. IBM Plex Sans Arabic covers Latin + Arabic (SIL OFL), so mixed
 * strings render with one font.
 */
const FONT_DIR = path.join(__dirname, 'fonts');

export const PDF_FONT_ARABIC = 'PlexArabic';
export const PDF_FONT_ARABIC_BOLD = 'PlexArabic-Bold';

const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

export function hasArabic(text: string): boolean {
  return ARABIC_RE.test(text);
}

/** Register the Arabic font family on a fresh document (idempotent per doc). */
export function registerArabicFonts(doc: PDFKit.PDFDocument): void {
  doc.registerFont(PDF_FONT_ARABIC, path.join(FONT_DIR, 'IBMPlexSansArabic-Regular.ttf'));
  doc.registerFont(PDF_FONT_ARABIC_BOLD, path.join(FONT_DIR, 'IBMPlexSansArabic-Bold.ttf'));
}

/**
 * Pick a font for a dynamic value: the requested Helvetica face when the text
 * is Latin-only, the Arabic family otherwise (bold preserved; italic falls
 * back to the upright cut — Plex Arabic ships no italics).
 */
export function fontFor(text: string, helvetica: string): string {
  if (!hasArabic(text)) return helvetica;
  return helvetica.includes('Bold') ? PDF_FONT_ARABIC_BOLD : PDF_FONT_ARABIC;
}

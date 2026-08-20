import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

import { fontFor, registerArabicFonts } from '../../../common/pdf/arabic-fonts';

export type PdfReceipt = { buffer: Buffer; ext: 'jpg' | 'png' };

export type PdfExpenseLine = {
  date: Date;
  category: string;
  merchantName: string | null;
  paymentMethod: string;
  amount: number;
  taxAmount: number | null;
  receipt: PdfReceipt | null;
};

export type PdfExpenseReport = {
  /** Period identifier — `YYYY-MM` for monthly, `YYYY-Qn` for quarterly. */
  period: string;
  /** Rendered header title, e.g. `Rapport des dépenses — 2026-08` or `Rapport trimestriel — 2026 Q3 (Juil–Sep)`. */
  title: string;
  business: { name: string; address?: string | null; ice?: string | null; phone?: string | null };
  lines: PdfExpenseLine[];
  totals: { total: number; byCategory: { category: string; total: number }[] };
};

const CATEGORY_LABEL: Record<string, string> = {
  rent: 'Loyer',
  utilities: 'Eau & électricité',
  salaries: 'Salaires',
  supplies: 'Fournitures',
  transport: 'Transport',
  maintenance: 'Maintenance',
  taxes: 'Impôts & taxes',
  marketing: 'Marketing',
  other: 'Autre',
};

const PAYMENT_LABEL: Record<string, string> = {
  cash: 'Espèces',
  card: 'Carte',
  credit: 'Crédit',
  split: 'Mixte',
};

/**
 * Renders the monthly expense report as an A4 PDF: summary table with
 * per-category subtotals and grand total (HT / TVA / TTC), then one page
 * per receipt image, cross-referenced with the table via `Pièce #N`.
 * Pure I/O-free rendering — receipts arrive as jpg/png buffers (the caller
 * converts webp beforehand; pdfkit embeds only JPEG and PNG).
 */
@Injectable()
export class ExpenseReportPdfService {
  render(report: PdfExpenseReport): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 40, compress: false });
      registerArabicFonts(doc);
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Sequential ID for each expense that has a receipt — printed in the
      // table's Pièce column and as a big header on the matching image page.
      // Lines without a receipt get null so accountants can spot missing docs.
      const pieceNos = new Map<PdfExpenseLine, number>();
      let n = 0;
      for (const line of report.lines) {
        if (line.receipt) pieceNos.set(line, ++n);
      }

      this.renderHeader(doc, report);
      this.renderTable(doc, report, pieceNos);
      this.renderTotals(doc, report);
      this.renderReceipts(doc, report, pieceNos);

      doc.end();
    });
  }

  private renderHeader(doc: PDFKit.PDFDocument, report: PdfExpenseReport): void {
    doc.font(fontFor(report.business.name, 'Helvetica')).fontSize(16).text(report.business.name);
    doc.fontSize(9).fillColor('#555');
    if (report.business.address) {
      doc.font(fontFor(report.business.address, 'Helvetica')).text(report.business.address);
    }
    const meta = [
      report.business.ice && `ICE: ${report.business.ice}`,
      report.business.phone && `Tél: ${report.business.phone}`,
    ]
      .filter(Boolean)
      .join('  ·  ');
    if (meta) doc.font('Helvetica').text(meta);
    doc.moveDown(0.5).fillColor('black');
    doc.fontSize(14).text(report.title);
    doc.moveDown(0.6);
  }

  private renderTable(
    doc: PDFKit.PDFDocument,
    report: PdfExpenseReport,
    pieceNos: Map<PdfExpenseLine, number>,
  ): void {
    // Widened right side for HT/TVA/TTC split; kept sums-friendly for A4 (40..555).
    const cols = {
      piece: 40,
      date: 72,
      merchant: 128,
      category: 245,
      payment: 328,
      ht: 385,
      tva: 440,
      ttc: 495,
    };
    const y0 = doc.y;
    doc.fontSize(9).fillColor('#000').font('Helvetica-Bold');
    doc.text('Pièce', cols.piece, y0, { width: 30 });
    doc.text('Date', cols.date, y0, { width: 55 });
    doc.text('Commerçant', cols.merchant, y0, { width: 115 });
    doc.text('Catégorie', cols.category, y0, { width: 80 });
    doc.text('Paiement', cols.payment, y0, { width: 55 });
    doc.text('HT', cols.ht, y0, { width: 52, align: 'right' });
    doc.text('TVA', cols.tva, y0, { width: 52, align: 'right' });
    doc.text('TTC', cols.ttc, y0, { width: 60, align: 'right' });
    doc.font('Helvetica');
    doc.moveTo(40, doc.y + 2).lineTo(555, doc.y + 2).stroke();
    doc.moveDown(0.4);

    for (const line of report.lines) {
      if (doc.y > 720) doc.addPage();
      const y = doc.y;
      const tva = line.taxAmount ?? 0;
      const ttc = line.amount;
      const ht = Math.max(0, ttc - tva);
      const piece = pieceNos.get(line);
      doc.font(piece ? 'Helvetica-Bold' : 'Helvetica').fillColor(piece ? '#0F766E' : '#999');
      doc.text(piece ? `#${piece}` : '—', cols.piece, y, { width: 30 });
      doc.font('Helvetica').fillColor('#000');
      doc.text(line.date.toISOString().slice(0, 10), cols.date, y, { width: 55 });
      doc
        .font(fontFor(line.merchantName ?? '', 'Helvetica'))
        .text(line.merchantName ?? '—', cols.merchant, y, { width: 115 });
      doc.font('Helvetica');
      doc.text(CATEGORY_LABEL[line.category] ?? line.category, cols.category, y, { width: 80 });
      doc.text(PAYMENT_LABEL[line.paymentMethod] ?? line.paymentMethod, cols.payment, y, {
        width: 55,
      });
      doc.text(ht.toFixed(2), cols.ht, y, { width: 52, align: 'right' });
      doc.text(line.taxAmount != null ? tva.toFixed(2) : '—', cols.tva, y, {
        width: 52,
        align: 'right',
      });
      doc.font('Helvetica-Bold').text(ttc.toFixed(2), cols.ttc, y, { width: 60, align: 'right' });
      doc.font('Helvetica');
      doc.moveDown(0.3);
    }

    doc.moveTo(40, doc.y + 4).lineTo(555, doc.y + 4).stroke();
    doc.moveDown(0.5);
  }

  private renderTotals(doc: PDFKit.PDFDocument, report: PdfExpenseReport): void {
    // Aggregate HT/TVA totals from lines so the summary matches the split table.
    let totalTva = 0;
    for (const l of report.lines) totalTva += l.taxAmount ?? 0;
    const totalTtc = report.totals.total;
    const totalHt = Math.max(0, totalTtc - totalTva);

    doc.fontSize(10);
    for (const row of report.totals.byCategory) {
      doc.text(`${CATEGORY_LABEL[row.category] ?? row.category}`, 320, doc.y, {
        width: 140,
        continued: false,
      });
      doc.moveUp();
      doc.text(row.total.toFixed(2), 460, doc.y, { width: 95, align: 'right' });
      doc.moveDown(0.15);
    }
    doc.moveDown(0.4);
    doc.moveTo(320, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(0.2);
    doc.fontSize(10).font('Helvetica');
    const totalRow = (label: string, value: number, bold = false): void => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
      doc.text(label, 320, doc.y, { width: 140 });
      doc.moveUp();
      doc.text(value.toFixed(2), 460, doc.y, { width: 95, align: 'right' });
      doc.moveDown(0.15);
      doc.font('Helvetica');
    };
    totalRow('Total HT', totalHt);
    totalRow('Total TVA', totalTva);
    doc.fontSize(12);
    totalRow('Total TTC', totalTtc, true);
    doc.fontSize(10);
  }

  private renderReceipts(
    doc: PDFKit.PDFDocument,
    report: PdfExpenseReport,
    pieceNos: Map<PdfExpenseLine, number>,
  ): void {
    for (const line of report.lines) {
      if (!line.receipt) continue;
      const piece = pieceNos.get(line);
      doc.addPage();

      // Anchor header — big Pièce number + full line context so an accountant
      // can cross-reference the image against the table row at a glance.
      doc.fontSize(18).font('Helvetica-Bold').fillColor('#0F766E');
      doc.text(`Pièce #${piece}`, 40, 40);
      doc.font('Helvetica').fillColor('#000').fontSize(10);

      const tva = line.taxAmount ?? 0;
      const ht = Math.max(0, line.amount - tva);
      const meta1 = [
        line.date.toISOString().slice(0, 10),
        line.merchantName,
        CATEGORY_LABEL[line.category] ?? line.category,
        PAYMENT_LABEL[line.paymentMethod] ?? line.paymentMethod,
      ]
        .filter(Boolean)
        .join('  ·  ');
      doc.text(meta1, 40, 68);
      doc.fontSize(9).fillColor('#444');
      doc.text(
        `HT ${ht.toFixed(2)} MAD  ·  TVA ${line.taxAmount != null ? tva.toFixed(2) + ' MAD' : '—'}  ·  TTC ${line.amount.toFixed(2)} MAD`,
        40,
        84,
      );
      doc.fillColor('#000');

      try {
        doc.image(line.receipt.buffer, 40, 110, { fit: [515, 680] });
      } catch {
        doc.fontSize(11).fillColor('#a00').text('Image illisible', 40, 130);
        doc.fillColor('black');
      }
    }
  }
}

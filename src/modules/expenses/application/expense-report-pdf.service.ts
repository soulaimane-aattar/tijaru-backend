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
  /** Report month as `YYYY-MM`. */
  month: string;
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
 * per-category subtotals and grand total, then one page per receipt image.
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

      this.renderHeader(doc, report);
      this.renderTable(doc, report);
      this.renderTotals(doc, report);
      this.renderReceipts(doc, report);

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
    doc.fontSize(14).text(`Rapport des dépenses — ${report.month}`);
    doc.moveDown(0.6);
  }

  private renderTable(doc: PDFKit.PDFDocument, report: PdfExpenseReport): void {
    const cols = { date: 40, merchant: 105, category: 255, payment: 360, amount: 425, tax: 495 };
    const y0 = doc.y;
    doc.fontSize(9).fillColor('#000');
    doc.text('Date', cols.date, y0);
    doc.text('Commerçant', cols.merchant, y0, { width: 145 });
    doc.text('Catégorie', cols.category, y0, { width: 100 });
    doc.text('Paiement', cols.payment, y0, { width: 60 });
    doc.text('Montant', cols.amount, y0, { width: 65, align: 'right' });
    doc.text('TVA', cols.tax, y0, { width: 60, align: 'right' });
    doc.moveTo(40, doc.y + 2).lineTo(555, doc.y + 2).stroke();
    doc.moveDown(0.4);

    for (const line of report.lines) {
      if (doc.y > 720) doc.addPage();
      const y = doc.y;
      doc.text(line.date.toISOString().slice(0, 10), cols.date, y);
      doc
        .font(fontFor(line.merchantName ?? '', 'Helvetica'))
        .text(line.merchantName ?? '—', cols.merchant, y, { width: 145 });
      doc.font('Helvetica');
      doc.text(CATEGORY_LABEL[line.category] ?? line.category, cols.category, y, { width: 100 });
      doc.text(PAYMENT_LABEL[line.paymentMethod] ?? line.paymentMethod, cols.payment, y, {
        width: 60,
      });
      doc.text(line.amount.toFixed(2), cols.amount, y, { width: 65, align: 'right' });
      doc.text(line.taxAmount != null ? line.taxAmount.toFixed(2) : '—', cols.tax, y, {
        width: 60,
        align: 'right',
      });
      doc.moveDown(0.3);
    }

    doc.moveTo(40, doc.y + 4).lineTo(555, doc.y + 4).stroke();
    doc.moveDown(0.5);
  }

  private renderTotals(doc: PDFKit.PDFDocument, report: PdfExpenseReport): void {
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
    doc.moveDown(0.3);
    doc.fontSize(12).text('Total', 320, doc.y, { width: 140 });
    doc.moveUp();
    doc.text(report.totals.total.toFixed(2), 460, doc.y, { width: 95, align: 'right' });
  }

  private renderReceipts(doc: PDFKit.PDFDocument, report: PdfExpenseReport): void {
    for (const line of report.lines) {
      if (!line.receipt) continue;
      doc.addPage();
      doc.fontSize(10).fillColor('#000');
      const label = [
        line.date.toISOString().slice(0, 10),
        line.merchantName,
        CATEGORY_LABEL[line.category] ?? line.category,
        `${line.amount.toFixed(2)} MAD`,
      ]
        .filter(Boolean)
        .join('  ·  ');
      doc.text(label, 40, 40);
      try {
        doc.image(line.receipt.buffer, 40, 70, { fit: [515, 700] });
      } catch {
        doc.fontSize(11).fillColor('#a00').text('Image illisible', 40, 90);
        doc.fillColor('black');
      }
    }
  }
}

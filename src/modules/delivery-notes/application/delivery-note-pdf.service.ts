import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

export type PdfNote = {
  number: string;
  type: 'order' | 'out' | 'in_';
  date: Date;
  status: string;
  signed: boolean;
  notes?: string | null;
  business: { name: string; address?: string | null; ice?: string | null; phone?: string | null };
  customer?: { name: string; phone?: string | null; address?: string | null } | null;
  supplier?: { name: string; phone?: string | null; address?: string | null } | null;
  issuedBy: { fullName: string };
  lines: Array<{
    label: string;
    ordered: string | number;
    sent: string | number;
    unitPrice: string | number;
  }>;
  totals: { subtotal: number };
};

const TYPE_LABEL: Record<PdfNote['type'], string> = {
  order: 'Bon de commande',
  out: 'Bon de livraison',
  in_: 'Bon de réception',
};

// Classic carnet layout metrics (A4, 40pt margins → 515pt of usable width).
const TABLE = {
  x: 40,
  w: 515,
  // column separator offsets from the table's left edge
  qtyW: 80,
  puX: 355,
  totalX: 425,
  headerH: 24,
  rowH: 22,
  minRows: 10,
};

/**
 * Renders a delivery note (bon) as a single-page A4 PDF styled after the
 * classic Moroccan carnet: "Mr. …… Doit" letterhead line, a bordered
 * Quantité / Désignation / PU / Total table with dotted writing lines, and a
 * "Date … Total [box]" footer. Pure I/O-free rendering — takes a
 * fully-resolved `PdfNote` (the caller merges the note DTO with
 * business/party lookups).
 */
@Injectable()
export class DeliveryNotePdfService {
  render(note: PdfNote): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 40, compress: false });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      this.renderHeader(doc, note);
      this.renderDoitLine(doc, note);
      this.renderTable(doc, note);
      this.renderFooter(doc, note);

      doc.end();
    });
  }

  private renderHeader(doc: PDFKit.PDFDocument, note: PdfNote): void {
    doc.fontSize(16).text(note.business.name, { continued: false });
    doc.fontSize(9).fillColor('#555');
    if (note.business.address) doc.text(note.business.address);
    const meta = [
      note.business.ice && `ICE: ${note.business.ice}`,
      note.business.phone && `Tél: ${note.business.phone}`,
    ]
      .filter(Boolean)
      .join('  ·  ');
    if (meta) doc.text(meta);
    doc.moveDown(0.5).fillColor('black');
  }

  /** "…… le 14/08/2026" top-right, then "Mr. <party> ………… Doit" over a dotted rule. */
  private renderDoitLine(doc: PDFKit.PDFDocument, note: PdfNote): void {
    const { x, w } = TABLE;
    doc.moveDown(0.6);

    doc
      .font('Helvetica-Oblique')
      .fontSize(10)
      .fillColor('#000')
      .text(
        `${TYPE_LABEL[note.type]}  ${note.number}${note.signed ? '   ·   Signé' : ''}`,
        x,
        doc.y,
        { width: w, align: 'left', continued: false },
      );
    doc.text(`le ${note.date.toLocaleDateString('fr-FR')}`, x, doc.y - 12, {
      width: w,
      align: 'right',
    });
    doc.moveDown(0.8);

    const to = note.type === 'out' ? note.customer : note.supplier;
    const y = doc.y;
    doc.font('Helvetica-BoldOblique').fontSize(12);
    doc.text('Mr.', x, y);
    doc.font('Helvetica-Oblique').fontSize(11);
    doc.text(to?.name ?? '', x + 26, y + 1, { width: w - 26 - 40 });
    doc.font('Helvetica-BoldOblique').fontSize(12);
    doc.text('Doit', x + w - 30, y);
    // dotted baseline under the party name
    doc
      .save()
      .dash(1.5, { space: 2 })
      .moveTo(x + 24, y + 14)
      .lineTo(x + w - 34, y + 14)
      .stroke('#000')
      .restore()
      .undash();
    doc.font('Helvetica').y = y + 24;
  }

  private renderTable(doc: PDFKit.PDFDocument, note: PdfNote): void {
    const { x, w, qtyW, puX, totalX, headerH, rowH, minRows } = TABLE;
    const top = doc.y;
    const rows = Math.max(note.lines.length, minRows);
    const bodyH = rows * rowH + 8;

    // header row box + column titles
    doc.lineWidth(1.2).rect(x, top, w, headerH).stroke('#000');
    doc.font('Helvetica-BoldOblique').fontSize(11).fillColor('#000');
    const ty = top + 6;
    doc.text('Quantité', x, ty, { width: qtyW, align: 'center' });
    doc.text('Désignation', x + qtyW, ty, { width: puX - qtyW, align: 'center' });
    doc.text('PU.', x + puX, ty, { width: totalX - puX, align: 'center' });
    doc.text('Total', x + totalX, ty, { width: w - totalX, align: 'center' });

    // body box + vertical separators
    const bTop = top + headerH + 2;
    doc.lineWidth(1.2).rect(x, bTop, w, bodyH).stroke('#000');
    for (const cx of [x + qtyW, x + puX, x + totalX]) {
      doc.moveTo(cx, top).lineTo(cx, top + headerH).stroke('#000');
      doc.moveTo(cx, bTop).lineTo(cx, bTop + bodyH).stroke('#000');
    }

    // rows: dotted writing lines, values sitting on top of them
    doc.font('Helvetica').fontSize(10);
    for (let i = 0; i < rows; i++) {
      const lineY = bTop + (i + 1) * rowH;
      doc
        .save()
        .lineWidth(0.7)
        .dash(1, { space: 1.6 });
      for (const [sx, ex] of [
        [x + 4, x + qtyW - 4],
        [x + qtyW + 4, x + puX - 4],
        [x + puX + 4, x + totalX - 4],
        [x + totalX + 4, x + w - 4],
      ]) {
        doc.moveTo(sx!, lineY).lineTo(ex!, lineY).stroke('#000');
      }
      doc.restore().undash();

      const l = note.lines[i];
      if (!l) continue;
      const qty = Number(note.type === 'out' ? l.sent : l.ordered);
      const pu = Number(l.unitPrice);
      const sub = Math.round(qty * pu * 100) / 100;
      const vy = lineY - 12;
      doc.text(String(qty), x + 4, vy, { width: qtyW - 8, align: 'center' });
      doc.text(l.label, x + qtyW + 8, vy, { width: puX - qtyW - 16 });
      doc.text(pu.toFixed(2), x + puX + 4, vy, { width: totalX - puX - 8, align: 'right' });
      doc.text(sub.toFixed(2), x + totalX + 4, vy, { width: w - totalX - 8, align: 'right' });
    }

    doc.y = bTop + bodyH + 12;
  }

  /** "Date: <date>    Total [boxed amount]" footer line, carnet style. */
  private renderFooter(doc: PDFKit.PDFDocument, note: PdfNote): void {
    const { x, w, totalX } = TABLE;
    const y = doc.y;

    doc.font('Helvetica-BoldOblique').fontSize(11);
    doc.text(`Date: ${note.date.toLocaleDateString('fr-FR')}`, x + 130, y);
    doc.text('Total', x + totalX - 45, y);

    // boxed grand total aligned under the Total column
    doc.lineWidth(1.2).rect(x + totalX, y - 5, w - totalX, 22).stroke('#000');
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(note.totals.subtotal.toFixed(2), x + totalX + 4, y, {
        width: w - totalX - 8,
        align: 'right',
      });

    doc.font('Helvetica').fontSize(8).fillColor('#666');
    doc.text(`Émis par ${note.issuedBy.fullName}`, x, y + 34);
    if (note.notes) doc.text(note.notes, x, doc.y + 4);
    doc.fillColor('black');
  }
}

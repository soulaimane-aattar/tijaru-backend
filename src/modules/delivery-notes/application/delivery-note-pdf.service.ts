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

/**
 * Renders a delivery note (bon) as a single-page A4 PDF: business letterhead,
 * bon number/status, destinataire block, line-item table, and total.
 * Pure I/O-free rendering — takes a fully-resolved `PdfNote` (the caller is
 * responsible for merging the note DTO with business/party lookups).
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
      this.renderTitle(doc, note);
      this.renderDestinataire(doc, note);
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

  private renderTitle(doc: PDFKit.PDFDocument, note: PdfNote): void {
    doc.fontSize(14).text(`${TYPE_LABEL[note.type]}  ${note.number}`);
    doc
      .fontSize(9)
      .fillColor('#555')
      .text(
        `Date: ${note.date.toISOString().slice(0, 10)}   Statut: ${note.status}${
          note.signed ? '   Signé' : ''
        }`,
      );
    doc.moveDown(0.5).fillColor('black');
  }

  private renderDestinataire(doc: PDFKit.PDFDocument, note: PdfNote): void {
    const to = note.type === 'out' ? note.customer : note.supplier;
    doc.fontSize(10).text('Destinataire:', { underline: true });
    if (to) {
      doc.text(to.name);
      if (to.address) doc.text(to.address);
      if (to.phone) doc.text(`Tél: ${to.phone}`);
    } else {
      doc.text('—');
    }
    doc.moveDown(0.8);
  }

  private renderTable(doc: PDFKit.PDFDocument, note: PdfNote): void {
    const cols = { label: 40, qty: 320, pu: 400, sub: 480 };
    const y0 = doc.y;
    doc.fontSize(10).fillColor('#000');
    doc.text('Produit', cols.label, y0);
    doc.text('Qté', cols.qty, y0, { width: 60, align: 'right' });
    doc.text('PU', cols.pu, y0, { width: 60, align: 'right' });
    doc.text('Sous-total', cols.sub, y0, { width: 75, align: 'right' });
    doc.moveTo(40, doc.y + 2).lineTo(555, doc.y + 2).stroke();
    doc.moveDown(0.4);

    for (const l of note.lines) {
      const qty = Number(note.type === 'out' ? l.sent : l.ordered);
      const pu = Number(l.unitPrice);
      const sub = Math.round(qty * pu * 100) / 100;
      const y = doc.y;
      doc.text(l.label, cols.label, y, { width: 270 });
      doc.text(qty.toFixed(3), cols.qty, y, { width: 60, align: 'right' });
      doc.text(pu.toFixed(2), cols.pu, y, { width: 60, align: 'right' });
      doc.text(sub.toFixed(2), cols.sub, y, { width: 75, align: 'right' });
      doc.moveDown(0.3);
    }

    doc.moveTo(40, doc.y + 4).lineTo(555, doc.y + 4).stroke();
    doc.moveDown(0.4);
    doc.fontSize(11).text('Total', cols.pu, doc.y, { width: 60, align: 'right', continued: true });
    doc.text(note.totals.subtotal.toFixed(2), { width: 75, align: 'right' });
  }

  private renderFooter(doc: PDFKit.PDFDocument, note: PdfNote): void {
    doc.moveDown(1.5).fontSize(8).fillColor('#666');
    doc.text(`Émis par ${note.issuedBy.fullName}`);
    if (note.notes) doc.moveDown(0.3).text(note.notes);
  }
}

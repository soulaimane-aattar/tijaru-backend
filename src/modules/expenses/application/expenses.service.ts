import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import sharp from 'sharp';

import { NotFoundError, ValidationError } from '../../../common/errors';
import { ExpenseCategoriesRepository } from '../../expense-categories/domain/expense-categories.repository';
import { BusinessInfoLookup } from '../domain/business-info.lookup';
import {
  ExpensesRepository,
  type ExpenseDuplicate,
  type ExpenseSummary,
} from '../domain/expenses.repository';
import { OcrProvider, type OcrSuggestion } from '../domain/ocr.provider';
import type {
  CreateExpenseInput,
  ListExpensesQuery,
  UpdateExpenseInput,
} from '../dto/expense.dto';
import { LocalStorageService } from '../../../common/storage/local-storage.service';

import type { PdfExpenseReport, PdfReceipt } from './expense-report-pdf.service';

export type ScanDuplicate = {
  id: string;
  date: string;
  amount: number;
  merchantName: string | null;
};

export type ScanResult = {
  receiptPath: string;
  receiptHash: string;
  ocrStatus: 'done' | 'failed';
  suggestion: OcrSuggestion | null;
  /** Set when a prior expense in this tenant stored the same receipt bytes. */
  duplicate: ScanDuplicate | null;
};

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const QUARTER_RE = /^\d{4}-Q[1-4]$/;

const QUARTER_MONTH_LABEL_FR: Record<1 | 2 | 3 | 4, string> = {
  1: 'Jan–Mar',
  2: 'Avr–Juin',
  3: 'Juil–Sep',
  4: 'Oct–Déc',
};

/** Fields of an Expense row the monthly report consumes. */
type ReportRow = {
  date: Date;
  category: string;
  merchantName: string | null;
  paymentMethod: string;
  amount: unknown;
  taxAmount: unknown;
  receiptPath: string | null;
};

@Injectable()
export class ExpensesService {
  constructor(
    private readonly expenses: ExpensesRepository,
    private readonly storage: LocalStorageService,
    private readonly ocr: OcrProvider,
    private readonly businessInfo: BusinessInfoLookup,
    private readonly categories: ExpenseCategoriesRepository,
  ) {}

  list(query: ListExpensesQuery): Promise<unknown[]> {
    return this.expenses.findAll(query);
  }

  summary(query: ListExpensesQuery): Promise<ExpenseSummary> {
    return this.expenses.summary(query);
  }

  async get(id: string): Promise<unknown> {
    const found = await this.expenses.findDetail(id);
    if (!found) throw new NotFoundError('Expense', id);
    return found;
  }

  async create(input: CreateExpenseInput, userId: string): Promise<unknown> {
    await this.assertCategoryUsable(input.category);
    return this.expenses.create({ ...input, createdById: userId });
  }

  async update(id: string, input: UpdateExpenseInput): Promise<unknown> {
    if (input.category !== undefined) await this.assertCategoryUsable(input.category);
    const updated = await this.expenses.update(id, input);
    if (updated === 0) throw new NotFoundError('Expense', id);
    return this.expenses.findDetail(id);
  }

  /**
   * A category the tenant has archived (or never defined) must not accept new
   * writes — but historical rows keep their key, so we do not touch existing data.
   */
  private async assertCategoryUsable(key: string): Promise<void> {
    const found = await this.categories.findByKey(key);
    if (!found) throw new ValidationError(`Unknown expense category: ${key}`);
    if (found.archived) throw new ValidationError(`Archived expense category: ${key}`);
  }

  async remove(id: string): Promise<void> {
    const found = await this.expenses.findById(id);
    if (!found) throw new NotFoundError('Expense', id);
    await this.expenses.delete(id);
    if (found.receiptPath) {
      // Best effort: a missing or unreadable file must not block the delete.
      await this.storage.remove(found.receiptPath).catch(() => undefined);
    }
  }

  /**
   * Store a receipt photo and return a best-effort field suggestion.
   *
   * Deliberately does NOT create an Expense: OCR output is a draft the user has
   * to confirm, and saving it silently would put unverified numbers in the books.
   */
  async scan(buffer: Buffer, businessId: string): Promise<ScanResult> {
    const ext = this.storage.sniffExtension(buffer);
    if (!ext) throw new ValidationError('Unsupported image format');

    const receiptHash = createHash('sha256').update(buffer).digest('hex');
    // Look up duplicates BEFORE writing — a hit still stores the file (user may
    // confirm the double-entry is intentional) but the UI needs the prior record
    // to render the warning banner.
    const prior = await this.expenses.findByReceiptHash(receiptHash);
    const receiptPath = await this.storage.save('receipts', businessId, buffer, ext);
    const result = await this.ocr.extract(buffer, `receipt.${ext}`);
    return {
      receiptPath,
      receiptHash,
      ocrStatus: result.status,
      suggestion: result.suggestion,
      duplicate: prior ? this.toDuplicate(prior) : null,
    };
  }

  private toDuplicate(row: ExpenseDuplicate): ScanDuplicate {
    return {
      id: row.id,
      date: row.date.toISOString(),
      amount: Number(row.amount),
      merchantName: row.merchantName,
    };
  }

  /**
   * Everything the monthly report PDF needs, fully resolved: the month's
   * expenses (oldest first), per-category totals, business letterhead, and
   * receipt bytes. Receipts degrade to `null` rather than failing the report —
   * a deleted file must not block the export. webp is converted to png because
   * pdfkit embeds only JPEG and PNG.
   */
  async monthlyReportData(month: string, businessId: string): Promise<PdfExpenseReport> {
    if (!MONTH_RE.test(month)) throw new ValidationError('month must be YYYY-MM');
    const [year, mon] = month.split('-').map(Number) as [number, number];
    const from = new Date(Date.UTC(year, mon - 1, 1));
    const to = new Date(Date.UTC(year, mon, 0, 23, 59, 59, 999));
    return this.assembleReport({
      period: month,
      title: `Rapport des dépenses — ${month}`,
      from,
      to,
      businessId,
    });
  }

  /** Same shape as monthlyReportData but spans a calendar quarter (`YYYY-Qn`). */
  async quarterlyReportData(quarter: string, businessId: string): Promise<PdfExpenseReport> {
    if (!QUARTER_RE.test(quarter)) throw new ValidationError('quarter must be YYYY-Qn');
    const year = Number(quarter.slice(0, 4));
    const q = Number(quarter.slice(6)) as 1 | 2 | 3 | 4;
    const startMonth = (q - 1) * 3;
    const from = new Date(Date.UTC(year, startMonth, 1));
    const to = new Date(Date.UTC(year, startMonth + 3, 0, 23, 59, 59, 999));
    return this.assembleReport({
      period: quarter,
      title: `Rapport trimestriel — ${year} Q${q} (${QUARTER_MONTH_LABEL_FR[q]})`,
      from,
      to,
      businessId,
    });
  }

  private async assembleReport(args: {
    period: string;
    title: string;
    from: Date;
    to: Date;
    businessId: string;
  }): Promise<PdfExpenseReport> {
    const { period, title, from, to, businessId } = args;
    const [rows, totals, business] = await Promise.all([
      this.expenses.findAll({ from, to }) as Promise<ReportRow[]>,
      this.expenses.summary({ from, to }),
      this.businessInfo.get(businessId),
    ]);

    const lines = await Promise.all(
      rows.reverse().map(async (row) => ({
        date: row.date,
        category: row.category,
        merchantName: row.merchantName,
        paymentMethod: row.paymentMethod,
        amount: Number(row.amount),
        taxAmount: row.taxAmount == null ? null : Number(row.taxAmount),
        receipt: await this.loadReceipt(row.receiptPath),
      })),
    );

    return {
      period,
      title,
      business: business ?? { name: '', address: null, ice: null, phone: null },
      lines,
      totals,
    };
  }

  private async loadReceipt(receiptPath: string | null): Promise<PdfReceipt | null> {
    if (!receiptPath) return null;
    try {
      const buffer = await this.storage.read(receiptPath);
      if (receiptPath.endsWith('.webp')) {
        return { buffer: await sharp(buffer).png().toBuffer(), ext: 'png' };
      }
      return { buffer, ext: receiptPath.endsWith('.png') ? 'png' : 'jpg' };
    } catch {
      return null;
    }
  }

  /** Receipt bytes for an expense the caller's tenant owns. */
  async readReceipt(id: string): Promise<{ buffer: Buffer; ext: string }> {
    const expense = await this.expenses.findById(id);
    // findById is tenant-filtered, so a cross-tenant id looks like a missing row.
    if (!expense?.receiptPath) throw new NotFoundError('Receipt', id);
    return {
      buffer: await this.storage.read(expense.receiptPath),
      ext: expense.receiptPath.split('.').pop() ?? 'jpg',
    };
  }
}

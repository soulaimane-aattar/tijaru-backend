import { Injectable } from '@nestjs/common';

import { NotFoundError, ValidationError } from '../../../common/errors';
import { ExpensesRepository, type ExpenseSummary } from '../domain/expenses.repository';
import { OcrProvider, type OcrSuggestion } from '../domain/ocr.provider';
import type {
  CreateExpenseInput,
  ListExpensesQuery,
  UpdateExpenseInput,
} from '../dto/expense.dto';
import { LocalStorageService } from '../infrastructure/local-storage.service';

export type ScanResult = {
  receiptPath: string;
  ocrStatus: 'done' | 'failed';
  suggestion: OcrSuggestion | null;
};

@Injectable()
export class ExpensesService {
  constructor(
    private readonly expenses: ExpensesRepository,
    private readonly storage: LocalStorageService,
    private readonly ocr: OcrProvider,
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

  create(input: CreateExpenseInput, userId: string): Promise<unknown> {
    return this.expenses.create({ ...input, createdById: userId });
  }

  async update(id: string, input: UpdateExpenseInput): Promise<unknown> {
    const updated = await this.expenses.update(id, input);
    if (updated === 0) throw new NotFoundError('Expense', id);
    return this.expenses.findDetail(id);
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

    const receiptPath = await this.storage.save(businessId, buffer, ext);
    const result = await this.ocr.extract(buffer, `receipt.${ext}`);
    return { receiptPath, ocrStatus: result.status, suggestion: result.suggestion };
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

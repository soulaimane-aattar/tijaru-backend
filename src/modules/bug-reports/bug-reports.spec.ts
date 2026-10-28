import { NotFoundError, ValidationError } from '../../common/errors';
import { LocalStorageService } from '../../common/storage/local-storage.service';
import { fakeDb } from '../../common/testing/db-fake';
import { PlatformAdminService } from '../platform-admin/platform-admin.service';

import { BugReportsService } from './application/bug-reports.service';
import { CreateBugReportSchema } from './dto/bug-report.dto';

describe('CreateBugReportSchema', () => {
  it('parses the multipart zone JSON string and keeps note', () => {
    const out = CreateBugReportSchema.parse({
      description: 'Bouton cassé',
      note: 'ctx',
      zone: JSON.stringify({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }),
    });
    expect(out.zone).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
    expect(out.note).toBe('ctx');
  });

  it('rejects a zone outside 0..1 or malformed JSON', () => {
    expect(() =>
      CreateBugReportSchema.parse({ description: 'x', zone: JSON.stringify({ x: 2, y: 0, w: 1, h: 1 }) }),
    ).toThrow();
    expect(() => CreateBugReportSchema.parse({ description: 'x', zone: '{nope' })).toThrow();
  });
});

describe('PlatformAdminService bug reports', () => {
  const make = (script: Record<string, unknown>) => {
    const f = fakeDb(script);
    const svc = new PlatformAdminService(f.db, {} as never, {} as never, {} as never, {} as never, {} as never);
    return { ...f, svc };
  };

  it('lists across businesses with status/type filters and pagination', async () => {
    const { svc, calls } = make({
      'select:app.bug_reports': (c: { values?: unknown }) => c.values === undefined && [{ id: 'b1', user_id: 'u1', business_id: 'biz1' }],
    });
    const out = await svc.listBugReports({ status: 'open', type: 'bug', page: 2, pageSize: 10 });
    const filters = calls.filter((c) => c.table === 'app.bug_reports').map((c) => c.where);
    expect(filters.every((w) => w.length === 2)).toBe(true);
    expect(filters[0]).toEqual([
      ['status', '=', 'open'],
      ['type', '=', 'bug'],
    ]);
    expect(out).toMatchObject({ page: 2, pageSize: 10 });
    expect(out.items).toHaveLength(1);
  });

  it('updates status, 404s on unknown id', async () => {
    const found = make({ 'update:app.bug_reports': { id: 'b1', status: 'resolved' } });
    await expect(found.svc.updateBugReportStatus('b1', 'resolved')).resolves.toEqual({ id: 'b1', status: 'resolved' });
    expect(found.calls[0]!.set).toEqual({ status: 'resolved' });
    const missing = make({ 'update:app.bug_reports': null }); // null = no row matched
    await expect(missing.svc.updateBugReportStatus('nope', 'resolved')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('BugReportsService screenshot handling', () => {
  const values = jest.fn().mockReturnThis();
  const insert = {
    values,
    returningAll: () => insert,
    executeTakeFirstOrThrow: jest.fn().mockResolvedValue({ id: 'b1' }),
  };
  const db = { q: { insertInto: jest.fn().mockReturnValue(insert) } };
  const storage = new LocalStorageService({ UPLOADS_DIR: '/tmp/ignored' } as never);
  const save = jest.spyOn(storage, 'save').mockResolvedValue('bug-reports/biz1/abc.png');
  const svc = new BugReportsService(db as never, storage);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);

  it('stores a real PNG under the tenant folder and keeps the relative path', async () => {
    await svc.create({ type: 'bug', description: 'x' }, png, 'biz1', 'u1');
    expect(save).toHaveBeenCalledWith('bug-reports', 'biz1', png, 'png');
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ screenshot: 'bug-reports/biz1/abc.png' }));
  });

  it('rejects non-image bytes even if declared as png', async () => {
    await expect(
      svc.create({ type: 'bug', description: 'x' }, Buffer.from('<?php echo 1; ?> padding'), 'biz1', 'u1'),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

import { NotFoundError, ValidationError } from '../../common/errors';
import { LocalStorageService } from '../../common/storage/local-storage.service';
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
  const bugReport = { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn(), update: jest.fn() };
  const svc = new PlatformAdminService({ bugReport } as never, {} as never, {} as never, {} as never);

  beforeEach(() => jest.clearAllMocks());

  it('lists across businesses with status/type filters and pagination', async () => {
    bugReport.findMany.mockResolvedValue([{ id: 'b1' }]);
    bugReport.count.mockResolvedValue(1);
    const out = await svc.listBugReports({ status: 'open', type: 'bug', page: 2, pageSize: 10 });
    expect(bugReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'open', type: 'bug' }, skip: 10, take: 10 }),
    );
    expect(out).toEqual({ items: [{ id: 'b1' }], total: 1, page: 2, pageSize: 10 });
  });

  it('updates status, 404s on unknown id', async () => {
    bugReport.findUnique.mockResolvedValueOnce({ id: 'b1' });
    bugReport.update.mockResolvedValue({ id: 'b1', status: 'resolved' });
    await expect(svc.updateBugReportStatus('b1', 'resolved')).resolves.toEqual({ id: 'b1', status: 'resolved' });
    bugReport.findUnique.mockResolvedValueOnce(null);
    await expect(svc.updateBugReportStatus('nope', 'resolved')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('BugReportsService screenshot handling', () => {
  const prisma = { bugReport: { create: jest.fn().mockResolvedValue({ id: 'b1' }) } };
  const storage = new LocalStorageService({ UPLOADS_DIR: '/tmp/ignored' } as never);
  const save = jest.spyOn(storage, 'save').mockResolvedValue('bug-reports/biz1/abc.png');
  const svc = new BugReportsService(prisma as never, storage);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);

  it('stores a real PNG under the tenant folder and keeps the relative path', async () => {
    await svc.create({ type: 'bug', description: 'x' }, png, 'biz1', 'u1');
    expect(save).toHaveBeenCalledWith('bug-reports', 'biz1', png, 'png');
    expect(prisma.bugReport.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ screenshot: 'bug-reports/biz1/abc.png' }) }),
    );
  });

  it('rejects non-image bytes even if declared as png', async () => {
    await expect(
      svc.create({ type: 'bug', description: 'x' }, Buffer.from('<?php echo 1; ?> padding'), 'biz1', 'u1'),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

import type { NotificationsRepository } from '../domain/notifications.repository';

import { NotificationsScannerService } from './notifications-scanner.service';

const mockRepo = (): jest.Mocked<NotificationsRepository> =>
  ({
    findRecent: jest.fn(),
    countUnread: jest.fn(),
    markRead: jest.fn(),
    markAllUnreadRead: jest.fn(),
    findLowStockCandidates: jest.fn().mockResolvedValue([]),
    findExpiringCandidates: jest.fn().mockResolvedValue([]),
    existsUnread: jest.fn().mockResolvedValue(false),
    create: jest.fn().mockResolvedValue(undefined),
  }) as unknown as jest.Mocked<NotificationsRepository>;

describe('NotificationsScannerService.scanNow', () => {
  let repo: jest.Mocked<NotificationsRepository>;
  let svc: NotificationsScannerService;

  beforeEach(() => {
    repo = mockRepo();
    svc = new NotificationsScannerService(repo);
  });

  it('creates lowStock notification per product w/ sum(qty) < minStock', async () => {
    repo.findLowStockCandidates.mockResolvedValue([
      { businessId: 'b1', productId: 'p1', productName: 'Sucre 1kg', totalQty: 3, minStock: 10 },
    ]);
    repo.findExpiringCandidates.mockResolvedValue([]);
    repo.existsUnread.mockResolvedValue(false);

    const result = await svc.scanNow();

    expect(result.lowStock).toBe(1);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'b1',
        type: 'lowStock',
        title: expect.stringContaining('Sucre 1kg'),
        body: expect.stringMatching(/stock 3.*seuil 10/),
      }),
    );
  });

  it('skips duplicate lowStock when existsUnread returns true', async () => {
    repo.findLowStockCandidates.mockResolvedValue([
      { businessId: 'b1', productId: 'p1', productName: 'Sucre 1kg', totalQty: 3, minStock: 10 },
    ]);
    repo.existsUnread.mockResolvedValue(true);

    const result = await svc.scanNow();

    expect(result.lowStock).toBe(0);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('creates expiring notification for product w/ expiry <= today+30d', async () => {
    const expiry = new Date(Date.now() + 5 * 86400000);
    repo.findLowStockCandidates.mockResolvedValue([]);
    repo.findExpiringCandidates.mockResolvedValue([
      { businessId: 'b1', id: 'p2', name: 'Yaourt', expiry },
    ]);
    repo.existsUnread.mockResolvedValue(false);

    const result = await svc.scanNow();

    expect(result.expiring).toBe(1);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'b1',
        type: 'expiring',
        title: 'Yaourt',
        body: expect.stringContaining('Yaourt'),
      }),
    );
  });

  it('creates outOfStock instead of lowStock when totalQty = 0', async () => {
    repo.findLowStockCandidates.mockResolvedValue([
      { businessId: 'b1', productId: 'p1', productName: 'Sucre 1kg', totalQty: 0, minStock: 10 },
    ]);
    repo.existsUnread.mockResolvedValue(false);

    await svc.scanNow();

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'outOfStock', body: expect.stringMatching(/rupture/) }),
    );
  });

  it('scanNow is tenant-safe: creates one notification per (businessId, productId)', async () => {
    repo.findLowStockCandidates.mockResolvedValue([
      { businessId: 'b1', productId: 'p1', productName: 'Sucre 1kg', totalQty: 3, minStock: 10 },
      { businessId: 'b2', productId: 'p1', productName: 'Sucre 1kg', totalQty: 1, minStock: 5 },
    ]);
    repo.existsUnread.mockResolvedValue(false);

    const result = await svc.scanNow();

    expect(result.lowStock).toBe(2);
    expect(repo.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ businessId: 'b1' }));
    expect(repo.create).toHaveBeenNthCalledWith(2, expect.objectContaining({ businessId: 'b2' }));
  });
});

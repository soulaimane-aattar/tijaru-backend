import { EmailRemindersService } from './email-reminders.service';

const NOW = new Date('2026-11-01T08:00:00Z');
const DAY = 86_400_000;

function setup() {
  const prisma = { business: { findMany: jest.fn().mockResolvedValue([]) }, user: { findMany: jest.fn().mockResolvedValue([]) } };
  const mail = { send: jest.fn().mockResolvedValue(true) };
  const svc = new EmailRemindersService(prisma as never, mail as never, { APP_URL: 'https://tijaru.com' } as never);
  return { prisma, mail, svc };
}

describe('EmailRemindersService', () => {
  it('queries one 24h window per reminder day (7, 3, 1) for expiring subscriptions', async () => {
    const { prisma, svc } = setup();
    await svc.run(NOW);
    const windows = prisma.business.findMany.mock.calls.map((c) => c[0].where.subscriptionEnd);
    expect(windows).toHaveLength(3);
    expect(windows[2]).toEqual({ gt: new Date(NOW.getTime()), lte: new Date(NOW.getTime() + DAY) });
    expect(windows[0].lte).toEqual(new Date(NOW.getTime() + 7 * DAY));
  });

  it('mails the owner of each expiring business and counts successes', async () => {
    const { prisma, mail, svc } = setup();
    prisma.business.findMany.mockResolvedValueOnce([
      { name: 'ISSA', subscriptionEnd: new Date(NOW.getTime() + 6.5 * DAY), users: [{ name: 'Omar', email: 'o@issa.ma' }] },
      { name: 'No owner', subscriptionEnd: new Date(NOW.getTime() + 6 * DAY), users: [] },
    ]);
    const res = await svc.run(NOW);
    expect(res.expiry).toBe(1);
    expect(mail.send).toHaveBeenCalledWith('o@issa.ma', expect.objectContaining({ subject: 'Votre abonnement expire dans 7 jours' }));
  });

  it('nudges inactive owners at 14 and 30 days, counting never-logged-in ones from creation', async () => {
    const { prisma, mail, svc } = setup();
    prisma.user.findMany.mockResolvedValueOnce([{ name: 'Omar', email: 'o@issa.ma', business: { name: 'ISSA' } }]);
    const res = await svc.run(NOW);
    expect(res.inactivity).toBe(1);
    const where = prisma.user.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ lastLogin: where.OR[0].lastLogin }, { lastLogin: null, createdAt: where.OR[0].lastLogin }]);
    expect(prisma.user.findMany).toHaveBeenCalledTimes(2);
    expect(mail.send.mock.calls[0][1].text).toContain('depuis 14 jours');
  });
});

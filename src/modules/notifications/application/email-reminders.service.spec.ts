import { fakeDb } from '../../../common/testing/db-fake';

import { EmailRemindersService } from './email-reminders.service';

const NOW = new Date('2026-11-01T08:00:00Z');
const DAY = 86_400_000;

function setup(script: Record<string, unknown> = {}) {
  const { db, calls } = fakeDb(script);
  const mail = { send: jest.fn().mockResolvedValue(true) };
  const svc = new EmailRemindersService(db, mail as never, { APP_URL: 'https://tijaru.com' } as never);
  return { calls, mail, svc };
}

describe('EmailRemindersService', () => {
  it('queries one 24h window per reminder day (7, 3, 1) for expiring subscriptions', async () => {
    const { calls, svc } = setup();
    await svc.run(NOW);
    const windows = calls
      .filter((c) => c.table === 'app.businesses')
      .map((c) => c.where.filter((w) => w[0] === 'subscription_end').map((w) => w[2]));
    expect(windows).toHaveLength(3);
    expect(windows[2]).toEqual([new Date(NOW.getTime()), new Date(NOW.getTime() + DAY)]);
    expect(windows[0]![1]).toEqual(new Date(NOW.getTime() + 7 * DAY));
  });

  it('mails the owner of each expiring business and counts successes', async () => {
    let first = true;
    const { mail, svc } = setup({
      'select:app.businesses': () => {
        if (!first) return [];
        first = false;
        return [
          { id: 'b1', name: 'ISSA', subscription_end: new Date(NOW.getTime() + 6.5 * DAY) },
          { id: 'b2', name: 'No owner', subscription_end: new Date(NOW.getTime() + 6 * DAY) },
        ];
      },
      'select:app_auth.users': [{ business_id: 'b1', name: 'Omar', email: 'o@issa.ma' }],
    });
    const res = await svc.run(NOW);
    expect(res.expiry).toBe(1);
    expect(mail.send).toHaveBeenCalledWith('o@issa.ma', expect.objectContaining({ subject: 'Votre abonnement expire dans 7 jours' }));
  });

  it('nudges inactive owners at 14 and 30 days', async () => {
    let first = true;
    const { calls, mail, svc } = setup({
      'select:app_auth.users as u': () => {
        if (!first) return [];
        first = false;
        return [{ name: 'Omar', email: 'o@issa.ma', business_name: 'ISSA' }];
      },
    });
    const res = await svc.run(NOW);
    expect(res.inactivity).toBe(1);
    expect(calls.filter((c) => c.table === 'app_auth.users as u')).toHaveLength(2);
    expect(mail.send.mock.calls[0][1].text).toContain('depuis 14 jours');
  });
});

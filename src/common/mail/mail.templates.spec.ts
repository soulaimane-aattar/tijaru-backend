import {
  businessApproved,
  businessRejected,
  inactivityReminder,
  registrationReceived,
  subscriptionExpiring,
} from './mail.templates';

const who = { ownerName: 'Omar', businessName: 'ISSA' };
const APP = 'https://tijaru.com';

describe('mail templates', () => {
  it('approval: French subject, login CTA in both html and text', () => {
    const m = businessApproved(who, APP);
    expect(m.subject).toContain('acceptée');
    expect(m.html).toContain('href="https://tijaru.com/login"');
    expect(m.text).toContain('Se connecter : https://tijaru.com/login');
    expect(m.html).toContain('lang="fr"');
  });

  it('escapes user-controlled names (no HTML injection) and keeps text readable', () => {
    const m = registrationReceived({ ownerName: '<img src=x onerror=alert(1)>', businessName: 'A & B "Shop"' });
    expect(m.html).not.toContain('<img');
    expect(m.html).toContain('A &amp; B &quot;Shop&quot;');
    expect(m.text).toContain('<img src=x onerror=alert(1)>');
    expect(m.text).toContain('A & B "Shop"');
  });

  it('expiry: singular/plural wording and the end date', () => {
    const end = new Date('2026-11-03T12:00:00Z');
    expect(subscriptionExpiring({ ...who, daysLeft: 1, endDate: end }, APP).subject).toBe('Votre abonnement expire demain');
    const m = subscriptionExpiring({ ...who, daysLeft: 7, endDate: end }, APP);
    expect(m.subject).toBe('Votre abonnement expire dans 7 jours');
    expect(m.text).toContain('novembre 2026');
  });

  it('inactivity and rejection render without a CTA where none is needed', () => {
    expect(inactivityReminder({ ...who, days: 14 }, APP).text).toContain('depuis 14 jours');
    expect(businessRejected(who).html).not.toContain('<a href');
  });
});

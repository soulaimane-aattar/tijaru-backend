import { MailService } from './mail.service';

const sendMail = jest.fn();
jest.mock('nodemailer', () => ({ createTransport: jest.fn(() => ({ sendMail })) }));

const base = { SMTP_PORT: 587, SMTP_SECURE: false, MAIL_FROM: 'Tijaru <no-reply@tijaru.com>' };
const mail = { subject: 's', html: '<p>h</p>', text: 't' };

describe('MailService', () => {
  beforeEach(() => sendMail.mockReset());

  it('is a no-op without SMTP_HOST', async () => {
    expect(await new MailService(base as never).send('a@b.c', mail)).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('sends from no-reply@tijaru.com', async () => {
    sendMail.mockResolvedValue({});
    expect(await new MailService({ ...base, SMTP_HOST: 'smtp.x' } as never).send('a@b.c', mail)).toBe(true);
    expect(sendMail).toHaveBeenCalledWith({ from: 'Tijaru <no-reply@tijaru.com>', to: 'a@b.c', ...mail });
  });

  it('swallows transport errors so callers never fail because of mail', async () => {
    sendMail.mockRejectedValue(new Error('connection refused'));
    expect(await new MailService({ ...base, SMTP_HOST: 'smtp.x' } as never).send('a@b.c', mail)).toBe(false);
  });
});

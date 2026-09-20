import { assertPublicWebhookUrl, isPrivateAddress, webhookUrlRefusalReason } from './webhook-url';

/**
 * The guard relaxes itself under NODE_ENV=test (the e2e suite posts to
 * 127.0.0.1), so these cases pin the production behaviour explicitly.
 */
const asProduction = async <T>(fn: () => T | Promise<T>): Promise<T> => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    return await fn();
  } finally {
    process.env.NODE_ENV = previous;
  }
};

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.5',
    '172.16.4.1',
    '172.31.255.255',
    '192.168.1.10',
    '169.254.169.254', // cloud metadata
    '100.64.0.1', // CGNAT
    '0.0.0.0',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
  ])('rejects %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '203.0.113.9', '2606:4700::1111'])('allows %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe('assertPublicWebhookUrl (production)', () => {
  it('accepts a public https URL', async () => {
    await asProduction(() => {
      expect(assertPublicWebhookUrl('https://hooks.example.com/tijaru').hostname).toBe(
        'hooks.example.com',
      );
    });
  });

  it.each([
    ['http://hooks.example.com', 'plain http'],
    ['https://localhost/hook', 'localhost'],
    ['https://127.0.0.1/hook', 'loopback literal'],
    ['https://169.254.169.254/latest/meta-data', 'metadata service'],
    ['https://postgres.internal/hook', 'internal TLD'],
    ['ftp://example.com/hook', 'foreign scheme'],
    ['not a url', 'garbage'],
  ])('rejects %s (%s)', async (url) => {
    await asProduction(() => {
      expect(() => assertPublicWebhookUrl(url)).toThrow();
    });
  });
});

describe('webhookUrlRefusalReason (production)', () => {
  it('refuses a host that resolves privately', async () => {
    // localhost resolves to 127.0.0.1 on every machine this runs on.
    await asProduction(async () => {
      expect(await webhookUrlRefusalReason('https://localhost/hook')).toMatch(/not a public/);
    });
  });

  it('refuses a host that does not resolve', async () => {
    await asProduction(async () => {
      expect(
        await webhookUrlRefusalReason('https://nx.invalid.tijaru-test/hook'),
      ).toMatch(/does not resolve/);
    });
  });

  it('allows loopback under NODE_ENV=test so the e2e receiver works', async () => {
    expect(await webhookUrlRefusalReason('http://127.0.0.1:9999/hook')).toBeNull();
  });
});

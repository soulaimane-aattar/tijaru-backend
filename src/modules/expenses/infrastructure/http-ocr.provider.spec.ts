import { HttpOcrProvider } from './http-ocr.provider';

const env = { OCR_SERVICE_URL: 'http://ocr:8000', OCR_TIMEOUT_MS: 50 } as never;

const okBody = (amount: number) => ({
  ok: true,
  json: async () => ({
    blocks: [{ text: 'TOTAL', box: [], score: 0.9 }],
    suggestion: {
      amount,
      taxAmount: 47.42,
      date: '2026-08-01',
      merchantName: 'MARJANE',
      confidence: { amount: 0.94, taxAmount: 0.8, date: 0.7, merchantName: 0.6 },
    },
  }),
});

describe('HttpOcrProvider', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the suggestion when the service answers', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(okBody(284.5) as never);

    const result = await new HttpOcrProvider(env).extract(Buffer.from('x'), 'r.jpg');

    expect(result.status).toBe('done');
    expect(result.suggestion?.amount).toBe(284.5);
    expect(result.blocks).toHaveLength(1);
  });

  it('degrades to failed when the service is unreachable', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await new HttpOcrProvider(env).extract(Buffer.from('x'), 'r.jpg');

    expect(result).toEqual({ status: 'failed', suggestion: null, blocks: [] });
  });

  it('degrades to failed on a non-2xx response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 500 } as never);

    const result = await new HttpOcrProvider(env).extract(Buffer.from('x'), 'r.jpg');

    expect(result.status).toBe('failed');
  });

  it('retries once before giving up', async () => {
    const spy = jest
      .spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(okBody(10) as never);

    const result = await new HttpOcrProvider(env).extract(Buffer.from('x'), 'r.jpg');

    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('done');
  });

  it('posts to the configured service URL', async () => {
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue(okBody(1) as never);

    await new HttpOcrProvider(env).extract(Buffer.from('x'), 'r.jpg');

    expect(spy).toHaveBeenCalledWith(
      'http://ocr:8000/extract',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

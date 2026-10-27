import { ImpersonateSchema } from './impersonate.dto';

describe('ImpersonateSchema', () => {
  it('accepts real (cuid) user ids and an empty body', () => {
    expect(ImpersonateSchema.parse({ userId: 'cmgj3k1x40000abcd1234efgh' }).userId).toBe('cmgj3k1x40000abcd1234efgh');
    expect(ImpersonateSchema.parse({})).toEqual({});
  });

  it('rejects an empty id', () => {
    expect(() => ImpersonateSchema.parse({ userId: '' })).toThrow();
  });
});

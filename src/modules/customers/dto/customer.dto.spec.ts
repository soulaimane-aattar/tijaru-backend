import {
  CreateCustomerCategorySchema as Create,
  CreateCustomerSchema,
  UpdateCustomerCategorySchema as Update,
  UpdateCustomerSchema,
} from './customer.dto';

const ok = { label: 'VIP', color: '#a1B2c3' };

describe('CreateCustomerCategorySchema', () => {
  it('accepts valid input and trims label', () => {
    expect(Create.parse({ ...ok, label: '  VIP  ' }).label).toBe('VIP');
  });
  it.each([[''], ['   ']])('rejects blank label %j', (label) => {
    expect(Create.safeParse({ ...ok, label }).success).toBe(false);
  });
  it('label max 60', () => {
    expect(Create.safeParse({ ...ok, label: 'a'.repeat(60) }).success).toBe(true);
    expect(Create.safeParse({ ...ok, label: 'a'.repeat(61) }).success).toBe(false);
  });
  it.each(['red', '#fff', '#12345', '#1234567', '123456', '#gggggg'])('rejects color %s', (color) => {
    expect(Create.safeParse({ ...ok, color }).success).toBe(false);
  });
  it('requires label and color', () => {
    expect(Create.safeParse({ color: '#000000' }).success).toBe(false);
    expect(Create.safeParse({ label: 'x' }).success).toBe(false);
  });
  it('creditLimit: 0, positive, null, omitted ok; negative / string rejected', () => {
    for (const creditLimit of [0, 100.5, null, undefined]) {
      expect(Create.safeParse({ ...ok, creditLimit }).success).toBe(true);
    }
    expect(Create.safeParse({ ...ok, creditLimit: -1 }).success).toBe(false);
    expect(Create.safeParse({ ...ok, creditLimit: '5' }).success).toBe(false);
  });
});

describe('UpdateCustomerCategorySchema', () => {
  it('accepts empty and partial bodies', () => {
    expect(Update.safeParse({}).success).toBe(true);
    expect(Update.safeParse({ creditLimit: null }).success).toBe(true);
  });
  it('still validates provided fields', () => {
    expect(Update.safeParse({ color: 'red' }).success).toBe(false);
    expect(Update.safeParse({ label: ' ' }).success).toBe(false);
    expect(Update.safeParse({ creditLimit: -5 }).success).toBe(false);
  });
});

describe('Customer schemas categoryId', () => {
  it('create accepts string, null, omitted; rejects empty string', () => {
    for (const categoryId of ['c1', null, undefined]) {
      expect(CreateCustomerSchema.safeParse({ name: 'A', categoryId }).success).toBe(true);
    }
    expect(CreateCustomerSchema.safeParse({ name: 'A', categoryId: '' }).success).toBe(false);
  });
  it('update accepts categoryId null alone', () => {
    expect(UpdateCustomerSchema.parse({ categoryId: null })).toEqual({ categoryId: null });
  });
});

/** Marks a create payload whose businessId is injected by the tenant middleware at runtime. */
export function scoped<T>(data: Omit<T, 'businessId'>): T {
  return data as T;
}

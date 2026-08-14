/** Port: letterhead details for the expense report PDF. */

export type BusinessInfo = {
  name: string;
  address: string | null;
  ice: string | null;
  phone: string | null;
};

export abstract class BusinessInfoLookup {
  abstract get(businessId: string): Promise<BusinessInfo | null>;
}

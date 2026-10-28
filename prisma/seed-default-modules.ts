import { makeSeedDb } from './db';

const MODULES = ['marketplace', 'pos', 'expenses', 'purchase-orders', 'inventory', 'reports', 'invoices', 'delivery-notes', 'hr', 'estimates'];

async function main() {
  const db = makeSeedDb();
  try {
    const now = new Date();
    const businesses = await db.selectFrom('app.businesses').select('id').execute();
    for (const biz of businesses) {
      await db.updateTable('app.businesses').set({ plan: 'active', updatedAt: now }).where('id', '=', biz.id).execute();
      await db
        .insertInto('app.business_modules')
        .values(MODULES.map((module_id) => ({ business_id: biz.id, module_id, active: true, updatedAt: now })))
        .onConflict((oc) => oc.columns(['business_id', 'module_id']).doNothing())
        .execute();
    }
    console.log(`Seeded ${businesses.length} businesses with default modules`);
  } finally {
    await db.destroy();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

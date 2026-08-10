import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const MODULES = ['pos', 'expenses', 'purchase-orders', 'inventory', 'reports', 'invoices'];

async function main() {
  const businesses = await prisma.business.findMany({ select: { id: true } });
  for (const biz of businesses) {
    await prisma.business.update({
      where: { id: biz.id },
      data: { plan: 'active' },
    });
    for (const moduleId of MODULES) {
      await prisma.businessModule.upsert({
        where: { businessId_moduleId: { businessId: biz.id, moduleId } },
        update: {},
        create: { businessId: biz.id, moduleId, active: true },
      });
    }
  }
  console.log(`Seeded ${businesses.length} businesses with default modules`);
}

main().catch(console.error).finally(() => prisma.$disconnect());

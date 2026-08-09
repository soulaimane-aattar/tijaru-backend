-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('trial', 'active', 'expired', 'suspended');

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "max_products" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "max_users" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "max_warehouses" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "plan" "SubscriptionPlan" NOT NULL DEFAULT 'trial',
ADD COLUMN     "subscription_end" TIMESTAMP(3),
ADD COLUMN     "subscription_start" TIMESTAMP(3);

import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { CapsGuard } from './common/guards/caps.guard';
import { JwtAuthGuard } from './common/guards/jwt.guard';
import { LimitGuard } from './common/guards/limit.guard';
import { ModuleGuard } from './common/guards/module.guard';
import { SubscriptionGuard } from './common/guards/subscription.guard';
import { TenantInterceptor } from './common/tenant/tenant.interceptor';
import { ConfigModule, ENV_TOKEN } from './config/config.module';
import type { Env } from './config/env';
import { ActivityModule } from './modules/activity/activity.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { CustomersModule } from './modules/customers/customers.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { HealthModule } from './modules/health/health.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { MovementsModule } from './modules/movements/movements.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PlatformAdminModule } from './modules/platform-admin/platform-admin.module';
import { PosModule } from './modules/pos/pos.module';
import { ProductsModule } from './modules/products/products.module';
import { PurchaseOrdersModule } from './modules/purchase-orders/po.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { UsersModule } from './modules/users/users.module';
import { WarehousesModule } from './modules/warehouses/warehouses.module';

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    UsersModule,
    ProductsModule,
    MovementsModule,
    WarehousesModule,
    CategoriesModule,
    SuppliersModule,
    CustomersModule,
    PosModule,
    AdminModule,
    PurchaseOrdersModule,
    InventoryModule,
    InvoicesModule,
    ReportsModule,
    ActivityModule,
    NotificationsModule,
    ExpensesModule,
    HealthModule,
    PlatformAdminModule,
    LoggerModule.forRootAsync({
      inject: [ENV_TOKEN],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          ...(env.NODE_ENV === 'development'
            ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
            : {}),
        },
      }),
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    JwtModule.register({ global: true }),
  ],
  providers: [
    // PrismaService + TenantContext come from the global ConfigModule — a single
    // instance each, so the tenant ALS store is shared between the HTTP
    // interceptor and the Prisma middleware.
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: SubscriptionGuard },
    { provide: APP_GUARD, useClass: ModuleGuard },
    { provide: APP_GUARD, useClass: LimitGuard },
    { provide: APP_GUARD, useClass: CapsGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
  ],
})
export class AppModule {}

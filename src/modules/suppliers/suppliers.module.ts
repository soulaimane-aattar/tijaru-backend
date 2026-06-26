import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Module,
  Param,
  Patch,
  Post,
  UsePipes,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { RequireCap } from '../../common/decorators/require-cap.decorator';
import { NotFoundError } from '../../common/errors';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../common/prisma.service';

const CreateSupplierSchema = z.object({
  name: z.string().min(1).max(160),
  contact: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
  city: z.string().max(80).optional(),
  ice: z
    .string()
    .regex(/^\d{15}$/, 'ICE must be 15 digits')
    .optional(),
  email: z.string().email().optional(),
});
type CreateSupplierInput = z.infer<typeof CreateSupplierSchema>;

const UpdateSupplierSchema = CreateSupplierSchema.partial();
type UpdateSupplierInput = z.infer<typeof UpdateSupplierSchema>;

@Injectable()
class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<unknown> {
    return this.prisma.supplier.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true, purchaseOrders: true } } },
    });
  }

  async get(id: string): Promise<unknown> {
    const s = await this.prisma.supplier.findUnique({
      where: { id },
      include: {
        products: { select: { id: true, name: true, sku: true } },
        purchaseOrders: {
          select: { id: true, number: true, status: true, date: true },
          orderBy: { date: 'desc' },
          take: 20,
        },
      },
    });
    if (!s) throw new NotFoundError('Supplier', id);
    return s;
  }

  create(input: CreateSupplierInput): Promise<unknown> {
    return this.prisma.supplier.create({
      data: { name: input.name, ...clean(input) } as { name: string } & Record<string, unknown>,
    });
  }

  async update(id: string, input: UpdateSupplierInput): Promise<unknown> {
    const r = await this.prisma.supplier.updateMany({ where: { id }, data: clean(input) });
    if (r.count === 0) throw new NotFoundError('Supplier', id);
    return this.prisma.supplier.findUnique({ where: { id } });
  }

  async remove(id: string): Promise<void> {
    const r = await this.prisma.supplier.deleteMany({ where: { id } });
    if (r.count === 0) throw new NotFoundError('Supplier', id);
  }
}

@ApiTags('suppliers')
@ApiBearerAuth()
@Controller({ path: 'suppliers', version: '1' })
class SuppliersController {
  constructor(private readonly svc: SuppliersService) {}

  @Get()
  @RequireCap('products.view')
  list(): Promise<unknown> {
    return this.svc.list();
  }

  @Get(':id')
  @RequireCap('products.view')
  get(@Param('id') id: string): Promise<unknown> {
    return this.svc.get(id);
  }

  @Post()
  @RequireCap('suppliers.manage')
  @UsePipes(new ZodValidationPipe(CreateSupplierSchema))
  create(@Body() body: CreateSupplierInput): Promise<unknown> {
    return this.svc.create(body);
  }

  @Patch(':id')
  @RequireCap('suppliers.manage')
  @UsePipes(new ZodValidationPipe(UpdateSupplierSchema))
  update(@Param('id') id: string, @Body() body: UpdateSupplierInput): Promise<unknown> {
    return this.svc.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireCap('suppliers.manage')
  async remove(@Param('id') id: string): Promise<void> {
    await this.svc.remove(id);
  }
}

function clean<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

@Module({
  controllers: [SuppliersController],
  providers: [SuppliersService, PrismaService],
})
export class SuppliersModule {}

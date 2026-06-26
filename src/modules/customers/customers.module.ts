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
  Query,
  UsePipes,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { RequireCap } from '../../common/decorators/require-cap.decorator';
import { NotFoundError } from '../../common/errors';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../common/prisma.service';

const CreateCustomerSchema = z.object({
  name: z.string().min(1).max(160),
  phone: z.string().max(40).optional(),
  city: z.string().max(80).optional(),
  ice: z
    .string()
    .regex(/^\d{15}$/, 'ICE must be 15 digits')
    .optional(),
});
type CreateCustomerInput = z.infer<typeof CreateCustomerSchema>;

const UpdateCustomerSchema = CreateCustomerSchema.partial();
type UpdateCustomerInput = z.infer<typeof UpdateCustomerSchema>;

const ListQuerySchema = z.object({
  search: z.string().optional(),
});
type ListQuery = z.infer<typeof ListQuerySchema>;

@Injectable()
class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  list(query: ListQuery): Promise<unknown> {
    const where = query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' as const } },
            { phone: { contains: query.search } },
            { ice: { contains: query.search } },
          ],
        }
      : {};
    return this.prisma.customer.findMany({ where, orderBy: { name: 'asc' } });
  }

  async get(id: string): Promise<unknown> {
    const c = await this.prisma.customer.findUnique({ where: { id } });
    if (!c) throw new NotFoundError('Customer', id);
    return c;
  }

  create(input: CreateCustomerInput): Promise<unknown> {
    return this.prisma.customer.create({
      data: { name: input.name, ...clean(input) } as { name: string } & Record<string, unknown>,
    });
  }

  async update(id: string, input: UpdateCustomerInput): Promise<unknown> {
    const r = await this.prisma.customer.updateMany({ where: { id }, data: clean(input) });
    if (r.count === 0) throw new NotFoundError('Customer', id);
    return this.prisma.customer.findUnique({ where: { id } });
  }

  async remove(id: string): Promise<void> {
    const r = await this.prisma.customer.deleteMany({ where: { id } });
    if (r.count === 0) throw new NotFoundError('Customer', id);
  }
}

@ApiTags('customers')
@ApiBearerAuth()
@Controller({ path: 'customers', version: '1' })
class CustomersController {
  constructor(private readonly svc: CustomersService) {}

  // Cashiers need customer list at POS — gate by stock.out (POS access proxy).
  @Get()
  @RequireCap('stock.out')
  list(@Query(new ZodValidationPipe(ListQuerySchema)) query: ListQuery): Promise<unknown> {
    return this.svc.list(query);
  }

  @Get(':id')
  @RequireCap('stock.out')
  get(@Param('id') id: string): Promise<unknown> {
    return this.svc.get(id);
  }

  @Post()
  @RequireCap('stock.out')
  @UsePipes(new ZodValidationPipe(CreateCustomerSchema))
  create(@Body() body: CreateCustomerInput): Promise<unknown> {
    return this.svc.create(body);
  }

  @Patch(':id')
  @RequireCap('suppliers.manage')
  @UsePipes(new ZodValidationPipe(UpdateCustomerSchema))
  update(@Param('id') id: string, @Body() body: UpdateCustomerInput): Promise<unknown> {
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
  controllers: [CustomersController],
  providers: [CustomersService, PrismaService],
})
export class CustomersModule {}

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
import { ConflictError, NotFoundError } from '../../common/errors';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../common/prisma.service';

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'tone must be #RRGGBB');

const CreateCategorySchema = z.object({
  name: z.string().min(1).max(80),
  icon: z.string().min(1).max(40),
  tone: HexColor,
});
type CreateCategoryInput = z.infer<typeof CreateCategorySchema>;

const UpdateCategorySchema = CreateCategorySchema.partial();
type UpdateCategoryInput = z.infer<typeof UpdateCategorySchema>;

@Injectable()
class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<unknown> {
    return this.prisma.category.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true } } },
    });
  }

  async create(input: CreateCategoryInput): Promise<unknown> {
    const dup = await this.prisma.category.findFirst({ where: { name: input.name } });
    if (dup) throw new ConflictError('Category name already exists');
    return this.prisma.category.create({ data: input });
  }

  async update(id: string, input: UpdateCategoryInput): Promise<unknown> {
    const existing = await this.prisma.category.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Category', id);
    const data: Record<string, unknown> = {};
    for (const k of ['name', 'icon', 'tone'] as const) {
      const v = input[k];
      if (v !== undefined) data[k] = v;
    }
    return this.prisma.category.update({ where: { id }, data });
  }

  async remove(id: string): Promise<void> {
    const inUse = await this.prisma.product.findFirst({
      where: { categoryId: id, deletedAt: null },
    });
    if (inUse) throw new ConflictError('Category is in use by products');
    const r = await this.prisma.category.deleteMany({ where: { id } });
    if (r.count === 0) throw new NotFoundError('Category', id);
  }
}

@ApiTags('categories')
@ApiBearerAuth()
@Controller({ path: 'categories', version: '1' })
class CategoriesController {
  constructor(private readonly svc: CategoriesService) {}

  @Get()
  @RequireCap('products.view')
  list(): Promise<unknown> {
    return this.svc.list();
  }

  @Post()
  @RequireCap('settings.manage')
  @UsePipes(new ZodValidationPipe(CreateCategorySchema))
  create(@Body() body: CreateCategoryInput): Promise<unknown> {
    return this.svc.create(body);
  }

  @Patch(':id')
  @RequireCap('settings.manage')
  @UsePipes(new ZodValidationPipe(UpdateCategorySchema))
  update(@Param('id') id: string, @Body() body: UpdateCategoryInput): Promise<unknown> {
    return this.svc.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireCap('settings.manage')
  async remove(@Param('id') id: string): Promise<void> {
    await this.svc.remove(id);
  }
}

@Module({
  controllers: [CategoriesController],
  providers: [CategoriesService, PrismaService],
})
export class CategoriesModule {}

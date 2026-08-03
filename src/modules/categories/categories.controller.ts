import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UsePipes,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { RequireCap } from '../../common/decorators/require-cap.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

import { CategoriesService } from './application/categories.service';
import {
  type CreateCategoryInput,
  CreateCategorySchema,
  type UpdateCategoryInput,
  UpdateCategorySchema,
} from './dto/category.dto';

@ApiTags('categories')
@ApiBearerAuth()
@Controller({ path: 'categories', version: '1' })
export class CategoriesController {
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

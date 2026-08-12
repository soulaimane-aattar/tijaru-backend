import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { AuthUser } from '../../common/auth/auth-user.type';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { EnforceLimit } from '../../common/decorators/enforce-limit.decorator';
import { RequireCap } from '../../common/decorators/require-cap.decorator';
import { StripPurchasePriceInterceptor } from '../../common/interceptors/strip-purchase-price.interceptor';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

import { ProductsService } from './application/products.service';
import { type AdjustProductInput, AdjustProductSchema } from './dto/adjust.dto';
import {
  type CreateProductInput,
  CreateProductSchema,
  type ListProductsQuery,
  ListProductsQuerySchema,
  type UpdateProductInput,
  UpdateProductSchema,
} from './dto/product.dto';

@ApiTags('products')
@ApiBearerAuth()
@UseInterceptors(StripPurchasePriceInterceptor)
@Controller({ path: 'products', version: '1' })
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequireCap('products.view')
  list(
    @Query(new ZodValidationPipe(ListProductsQuerySchema)) query: ListProductsQuery,
  ): Promise<unknown> {
    return this.products.list(query);
  }

  @Get(':id')
  @RequireCap('products.view')
  get(@Param('id') id: string): Promise<unknown> {
    return this.products.get(id);
  }

  @Post()
  @RequireCap('products.create')
  @EnforceLimit('products')
  @UsePipes(new ZodValidationPipe(CreateProductSchema))
  create(@Body() body: CreateProductInput): Promise<unknown> {
    return this.products.create(body);
  }

  @Patch(':id')
  @RequireCap('products.edit')
  @UsePipes(new ZodValidationPipe(UpdateProductSchema))
  update(@Param('id') id: string, @Body() body: UpdateProductInput): Promise<unknown> {
    return this.products.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireCap('products.delete')
  async remove(@Param('id') id: string): Promise<void> {
    await this.products.remove(id);
  }

  @Post(':id/duplicate')
  @RequireCap('products.create')
  duplicate(@Param('id') id: string): Promise<unknown> {
    return this.products.duplicate(id);
  }

  @Post(':id/adjust')
  @RequireCap('products.edit')
  @UsePipes(new ZodValidationPipe(AdjustProductSchema))
  adjust(
    @Param('id') id: string,
    @Body() body: AdjustProductInput,
    @CurrentUser() user: AuthUser,
  ): Promise<unknown> {
    return this.products.adjust(user, id, body);
  }
}

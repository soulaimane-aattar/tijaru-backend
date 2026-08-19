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
  Res,
  UploadedFile,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import type { AuthUser } from '../../common/auth/auth-user.type';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { EnforceLimit } from '../../common/decorators/enforce-limit.decorator';
import { RequireCap } from '../../common/decorators/require-cap.decorator';
import { ValidationError } from '../../common/errors';
import { StripPurchasePriceInterceptor } from '../../common/interceptors/strip-purchase-price.interceptor';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { TenantContext } from '../../common/tenant/tenant-context';

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

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  webp: 'image/webp',
  jpg: 'image/jpeg',
};

@ApiTags('products')
@ApiBearerAuth()
@UseInterceptors(StripPurchasePriceInterceptor)
@Controller({ path: 'products', version: '1' })
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly tenant: TenantContext,
  ) {}

  @Get()
  @RequireCap('products.view')
  list(
    @Query(new ZodValidationPipe(ListProductsQuerySchema)) query: ListProductsQuery,
  ): Promise<unknown> {
    return this.products.list(query);
  }

  @Get('by-barcode/:code')
  @RequireCap('products.view')
  findByBarcode(@Param('code') code: string, @CurrentUser() user: AuthUser): Promise<unknown> {
    return this.products.findByBarcode(user, code);
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

  /**
   * Serve product images from an authenticated endpoint. A public static
   * mount would let anyone with the URL enumerate other tenants' images —
   * tenant-scoped IDs stay behind auth here.
   */
  @Get(':id/image')
  @RequireCap('products.view')
  async image(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const { buffer, ext } = await this.products.readImage(id);
    res.setHeader('content-type', MIME_BY_EXT[ext] ?? 'image/jpeg');
    res.setHeader('cache-control', 'private, max-age=3600');
    res.send(buffer);
  }

  @Post(':id/image')
  @RequireCap('products.edit')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES } }))
  uploadImage(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<unknown> {
    if (!file) throw new ValidationError('file is required');
    const businessId = this.tenant.getBusinessId();
    if (!businessId) throw new ValidationError('missing tenant context');
    return this.products.uploadImage(id, file.buffer, businessId);
  }

  @Delete(':id/image')
  @HttpCode(204)
  @RequireCap('products.edit')
  async removeImage(@Param('id') id: string): Promise<void> {
    await this.products.deleteImage(id);
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

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { RequireCap } from '../../common/decorators/require-cap.decorator';
import { RequiresModule } from '../../common/decorators/require-module.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { TenantContext } from '../../common/tenant/tenant-context';

import { MarketplaceService } from './application/marketplace.service';
import {
  type CatalogQuery,
  CatalogQuerySchema,
  type CreateListingInput,
  CreateListingSchema,
  type PriceGroupInput,
  PriceGroupSchema,
  type ReplaceTiersInput,
  ReplaceTiersSchema,
  type UpdateListingInput,
  UpdateListingSchema,
} from './dto/marketplace.dto';

@ApiTags('marketplace')
@ApiBearerAuth()
@RequiresModule('marketplace')
@Controller({ path: 'marketplace', version: '1' })
export class MarketplaceController {
  constructor(
    private readonly svc: MarketplaceService,
    private readonly tenant: TenantContext,
  ) {}

  private bid(): string {
    const id = this.tenant.getBusinessId();
    if (!id) throw new Error('missing tenant');
    return id;
  }

  // ─── price groups (seller) ─────────────────────────────────────────────────

  @Get('price-groups')
  @RequireCap('marketplace.manage')
  listPriceGroups(): Promise<unknown> {
    return this.svc.listPriceGroups(this.bid());
  }

  @Post('price-groups')
  @RequireCap('marketplace.manage')
  createPriceGroup(
    @Body(new ZodValidationPipe(PriceGroupSchema)) body: PriceGroupInput,
  ): Promise<unknown> {
    return this.svc.createPriceGroup(this.bid(), body);
  }

  @Delete('price-groups/:id')
  @RequireCap('marketplace.manage')
  @HttpCode(204)
  async deletePriceGroup(@Param('id') id: string): Promise<void> {
    await this.svc.deletePriceGroup(this.bid(), id);
  }

  // ─── catalog (buyer) ───────────────────────────────────────────────────────
  // Declared before `listings/:id` style routes to keep path matching obvious.

  @Get('catalog')
  @RequireCap('marketplace.buy')
  catalog(
    @Query(new ZodValidationPipe(CatalogQuerySchema)) query: CatalogQuery,
  ): Promise<unknown> {
    return this.svc.catalog(this.bid(), query);
  }

  @Get('sellers')
  @RequireCap('marketplace.buy')
  sellers(): Promise<unknown> {
    return this.svc.listSellers(this.bid());
  }

  // ─── listings (seller) ─────────────────────────────────────────────────────

  @Get('listings')
  @RequireCap('marketplace.manage')
  listListings(): Promise<unknown> {
    return this.svc.listListings(this.bid());
  }

  @Post('listings')
  @RequireCap('marketplace.manage')
  createListing(
    @Body(new ZodValidationPipe(CreateListingSchema)) body: CreateListingInput,
  ): Promise<unknown> {
    return this.svc.createListing(this.bid(), body);
  }

  @Patch('listings/:id')
  @RequireCap('marketplace.manage')
  updateListing(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateListingSchema)) body: UpdateListingInput,
  ): Promise<unknown> {
    return this.svc.updateListing(this.bid(), id, body);
  }

  @Put('listings/:id/tiers')
  @RequireCap('marketplace.manage')
  replaceTiers(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReplaceTiersSchema)) body: ReplaceTiersInput,
  ): Promise<unknown> {
    return this.svc.replaceTiers(this.bid(), id, body.tiers);
  }

  @Delete('listings/:id')
  @RequireCap('marketplace.manage')
  @HttpCode(204)
  async deleteListing(@Param('id') id: string): Promise<void> {
    await this.svc.deleteListing(this.bid(), id);
  }
}

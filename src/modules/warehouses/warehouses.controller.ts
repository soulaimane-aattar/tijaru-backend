import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UsePipes } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { RequireCap } from '../../common/decorators/require-cap.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

import { WarehousesService } from './application/warehouses.service';
import {
  type CreateWarehouseInput,
  CreateWarehouseSchema,
  type UpdateWarehouseInput,
  UpdateWarehouseSchema,
} from './dto/warehouse.dto';

@ApiTags('warehouses')
@ApiBearerAuth()
@Controller({ path: 'warehouses', version: '1' })
export class WarehousesController {
  constructor(private readonly warehouses: WarehousesService) {}

  // List is available to anyone with products.view — needed for warehouse selector pill on dashboard.
  @Get()
  @RequireCap('products.view')
  list(): Promise<unknown> {
    return this.warehouses.list();
  }

  @Get(':id')
  @RequireCap('products.view')
  get(@Param('id') id: string): Promise<unknown> {
    return this.warehouses.get(id);
  }

  @Post()
  @RequireCap('warehouses.manage')
  @UsePipes(new ZodValidationPipe(CreateWarehouseSchema))
  create(@Body() body: CreateWarehouseInput): Promise<unknown> {
    return this.warehouses.create(body);
  }

  @Patch(':id')
  @RequireCap('warehouses.manage')
  @UsePipes(new ZodValidationPipe(UpdateWarehouseSchema))
  update(@Param('id') id: string, @Body() body: UpdateWarehouseInput): Promise<unknown> {
    return this.warehouses.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireCap('warehouses.manage')
  async remove(@Param('id') id: string): Promise<void> {
    await this.warehouses.remove(id);
  }
}

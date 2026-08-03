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

import { SuppliersService } from './application/suppliers.service';
import {
  type CreateSupplierInput,
  CreateSupplierSchema,
  type UpdateSupplierInput,
  UpdateSupplierSchema,
} from './dto/supplier.dto';

@ApiTags('suppliers')
@ApiBearerAuth()
@Controller({ path: 'suppliers', version: '1' })
export class SuppliersController {
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

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
  UsePipes,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { RequireCap } from '../../common/decorators/require-cap.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

import { CustomersService } from './application/customers.service';
import {
  type CreateCustomerCategoryInput,
  CreateCustomerCategorySchema,
  type CreateCustomerInput,
  CreateCustomerSchema,
  type ListCustomersQuery,
  ListCustomersQuerySchema,
  type UpdateCustomerCategoryInput,
  UpdateCustomerCategorySchema,
  type UpdateCustomerInput,
  UpdateCustomerSchema,
} from './dto/customer.dto';

@ApiTags('customers')
@ApiBearerAuth()
@Controller({ path: 'customers', version: '1' })
export class CustomersController {
  constructor(private readonly svc: CustomersService) {}

  // Declared before ':id' so 'categories' is not read as a customer id.
  @Get('categories')
  @RequireCap('stock.out')
  listCategories(): Promise<unknown> {
    return this.svc.listCategories();
  }

  @Post('categories')
  @RequireCap('suppliers.manage')
  @UsePipes(new ZodValidationPipe(CreateCustomerCategorySchema))
  createCategory(@Body() body: CreateCustomerCategoryInput): Promise<unknown> {
    return this.svc.createCategory(body);
  }

  @Patch('categories/:id')
  @RequireCap('suppliers.manage')
  @UsePipes(new ZodValidationPipe(UpdateCustomerCategorySchema))
  updateCategory(@Param('id') id: string, @Body() body: UpdateCustomerCategoryInput): Promise<unknown> {
    return this.svc.updateCategory(id, body);
  }

  @Delete('categories/:id')
  @HttpCode(204)
  @RequireCap('suppliers.manage')
  async removeCategory(@Param('id') id: string): Promise<void> {
    await this.svc.removeCategory(id);
  }

  // Cashiers need customer list at POS — gate by stock.out (POS access proxy).
  @Get()
  @RequireCap('stock.out')
  list(
    @Query(new ZodValidationPipe(ListCustomersQuerySchema)) query: ListCustomersQuery,
  ): Promise<unknown> {
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

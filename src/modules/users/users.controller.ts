import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UsePipes } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { RequireCap } from '../../common/decorators/require-cap.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

import { UsersService } from './application/users.service';
import {
  type CreateUserInput,
  CreateUserSchema,
  type UpdateUserInput,
  UpdateUserSchema,
} from './dto/user.dto';

@ApiTags('users')
@ApiBearerAuth()
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequireCap('users.manage')
  list(): Promise<unknown> {
    return this.users.list();
  }

  @Get(':id')
  @RequireCap('users.manage')
  get(@Param('id') id: string): Promise<unknown> {
    return this.users.get(id);
  }

  @Post()
  @RequireCap('users.manage')
  @UsePipes(new ZodValidationPipe(CreateUserSchema))
  create(@Body() body: CreateUserInput): Promise<unknown> {
    return this.users.create(body);
  }

  @Patch(':id')
  @RequireCap('users.manage')
  @UsePipes(new ZodValidationPipe(UpdateUserSchema))
  update(@Param('id') id: string, @Body() body: UpdateUserInput): Promise<unknown> {
    return this.users.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireCap('users.manage')
  async remove(@Param('id') id: string): Promise<void> {
    await this.users.remove(id);
  }
}

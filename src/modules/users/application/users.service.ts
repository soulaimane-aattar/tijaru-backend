import { Inject, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { ConflictError, NotFoundError } from '../../../common/errors';
import { ENV_TOKEN } from '../../../config/config.module';
import type { Env } from '../../../config/env';
import { UsersRepository } from '../domain/users.repository';
import type { CreateUserInput, UpdateUserInput } from '../dto/user.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly users: UsersRepository,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {}

  list(): Promise<unknown> {
    return this.users.findAllSafe();
  }

  async get(id: string): Promise<unknown> {
    const user = await this.users.findDetail(id);
    if (!user) throw new NotFoundError('User', id);
    return user;
  }

  async create(input: CreateUserInput): Promise<unknown> {
    const email = input.email.toLowerCase();
    if (await this.users.emailInUse(email)) {
      throw new ConflictError('Email already in use');
    }

    const hash = await bcrypt.hash(input.password, this.env.BCRYPT_COST);
    return this.users.create({
      name: input.name,
      email,
      phone: input.phone ?? null,
      passwordHash: hash,
      role: input.role,
      warehouseIds: input.warehouseIds,
    });
  }

  async update(id: string, input: UpdateUserInput): Promise<unknown> {
    if (!(await this.users.exists(id))) throw new NotFoundError('User', id);

    const { warehouseIds, email, password, ...rest } = input;

    let passwordHash: string | undefined;
    if (password) {
      passwordHash = await bcrypt.hash(password, this.env.BCRYPT_COST);
    }

    return this.users.update(
      id,
      {
        ...rest,
        email: email === undefined ? undefined : email.toLowerCase(),
        ...(passwordHash ? { passwordHash } : {}),
      },
      warehouseIds,
    );
  }

  async remove(id: string): Promise<void> {
    if (!(await this.users.exists(id))) throw new NotFoundError('User', id);
    await this.users.softDelete(id);
  }
}

import { Inject, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { ConflictError, DomainError, NotFoundError } from '../../../common/errors';
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

  /**
   * Turns the requested allow-list into storage fields. Rejects modules the
   * business does not have active (an owner can only hand out what the platform
   * admin allowed) and any attempt to restrict an owner.
   */
  private async moduleFields(
    role: string,
    modules: string[] | null | undefined,
  ): Promise<{ restrictModules: boolean; moduleAccess: string[] } | undefined> {
    if (modules === undefined) return undefined;
    if (modules === null) return { restrictModules: false, moduleAccess: [] };
    if (role === 'owner') {
      throw new DomainError('owner_unrestricted', 'Owners always have every module', 422);
    }
    const allowed = new Set(await this.users.activeModuleIds());
    const unknown = modules.filter((m) => !allowed.has(m));
    if (unknown.length) {
      throw new DomainError('module_not_available', `Not available: ${unknown.join(', ')}`, 422);
    }
    return { restrictModules: true, moduleAccess: [...new Set(modules)] };
  }

  async create(input: CreateUserInput): Promise<unknown> {
    const email = input.email.toLowerCase();
    if (await this.users.emailInUse(email)) {
      throw new ConflictError('Email already in use');
    }

    const mods = await this.moduleFields(input.role, input.modules);
    const hash = await bcrypt.hash(input.password, this.env.BCRYPT_COST);
    return this.users.create({
      name: input.name,
      email,
      phone: input.phone ?? null,
      passwordHash: hash,
      role: input.role,
      warehouseIds: input.warehouseIds,
      restrictModules: mods?.restrictModules ?? false,
      moduleAccess: mods?.moduleAccess ?? [],
    });
  }

  async update(id: string, input: UpdateUserInput): Promise<unknown> {
    if (!(await this.users.exists(id))) throw new NotFoundError('User', id);

    const { warehouseIds, email, password, modules, ...rest } = input;
    const role = rest.role ?? (await this.users.findRole(id)) ?? '';
    const mods = await this.moduleFields(role, modules);
    // Promoting someone to owner drops any restriction they had.
    const clear =
      rest.role === 'owner' ? { restrictModules: false, moduleAccess: [] as string[] } : undefined;

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
        ...(mods ?? clear ?? {}),
      },
      warehouseIds,
    );
  }

  async remove(id: string): Promise<void> {
    if (!(await this.users.exists(id))) throw new NotFoundError('User', id);
    await this.users.softDelete(id);
  }
}

import { Inject, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { ConflictError, NotFoundError } from '../../../common/errors';
import { PrismaService } from '../../../common/prisma.service';
import { ENV_TOKEN } from '../../../config/config.module';
import type { Env } from '../../../config/env';
import type { CreateUserInput, UpdateUserInput } from '../dto/user.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {}

  private readonly safeSelect = {
    id: true,
    name: true,
    email: true,
    phone: true,
    role: true,
    active: true,
    lastLogin: true,
    createdAt: true,
    updatedAt: true,
    warehouses: { select: { warehouseId: true } },
  } as const;

  list(): Promise<unknown> {
    return this.prisma.user.findMany({
      where: { deletedAt: null },
      select: this.safeSelect,
      orderBy: { createdAt: 'asc' },
    });
  }

  async get(id: string): Promise<unknown> {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: { ...this.safeSelect, overrides: true },
    });
    if (!user) throw new NotFoundError('User', id);
    return user;
  }

  async create(input: CreateUserInput): Promise<unknown> {
    const existing = await this.prisma.user.findFirst({
      where: { email: input.email.toLowerCase(), deletedAt: null },
    });
    if (existing) throw new ConflictError('Email already in use');

    const hash = await bcrypt.hash(input.password, this.env.BCRYPT_COST);
    return this.prisma.user.create({
      data: {
        name: input.name,
        email: input.email.toLowerCase(),
        phone: input.phone ?? null,
        passwordHash: hash,
        role: input.role,
        warehouses: {
          create: input.warehouseIds.map((wid) => ({ warehouseId: wid })),
        },
      },
      select: this.safeSelect,
    });
  }

  async update(id: string, input: UpdateUserInput): Promise<unknown> {
    const existing = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundError('User', id);

    return this.prisma.$transaction(async (tx) => {
      if (input.warehouseIds !== undefined) {
        await tx.userWarehouse.deleteMany({ where: { userId: id } });
        await tx.userWarehouse.createMany({
          data: input.warehouseIds.map((wid) => ({ userId: id, warehouseId: wid })),
        });
      }
      const data: Record<string, unknown> = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.email !== undefined) data.email = input.email.toLowerCase();
      if (input.phone !== undefined) data.phone = input.phone;
      if (input.role !== undefined) data.role = input.role;
      if (input.active !== undefined) data.active = input.active;
      return tx.user.update({
        where: { id },
        data,
        include: { warehouses: { select: { warehouseId: true } } },
      });
    });
  }

  async remove(id: string): Promise<void> {
    const existing = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundError('User', id);
    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), active: false, tokenVersion: { increment: 1 } },
    });
  }
}

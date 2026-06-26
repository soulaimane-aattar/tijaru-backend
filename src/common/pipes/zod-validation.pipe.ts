import { type ArgumentMetadata, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

import { ValidationError } from '../errors';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    // Only validate the body / query — leave route params, headers, etc. untouched.
    if (metadata.type !== 'body' && metadata.type !== 'query') return value;
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const errors: Record<string, string[]> = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join('.') || '_';
        (errors[key] ??= []).push(issue.message);
      }
      throw new ValidationError('Invalid request body', errors);
    }
    return result.data;
  }
}

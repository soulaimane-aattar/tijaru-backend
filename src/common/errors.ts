import { HttpException, HttpStatus } from '@nestjs/common';

export type ProblemDetail = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  code: string;
  errors?: Record<string, string[]>;
};

export class DomainError extends HttpException {
  constructor(code: string, message: string, status: HttpStatus = HttpStatus.BAD_REQUEST) {
    const problem: ProblemDetail = {
      type: `https://stock.local/errors/${code}`,
      title: message,
      status,
      code,
    };
    super(problem, status);
  }
}

export class NotFoundError extends DomainError {
  constructor(resource: string, id?: string) {
    super('not_found', `${resource}${id ? ` ${id}` : ''} not found`, HttpStatus.NOT_FOUND);
  }
}

export class ForbiddenError extends DomainError {
  constructor(cap?: string) {
    super('forbidden', cap ? `Missing capability: ${cap}` : 'Forbidden', HttpStatus.FORBIDDEN);
  }
}

export class UnauthorizedError extends DomainError {
  constructor(detail = 'Unauthorized') {
    super('unauthorized', detail, HttpStatus.UNAUTHORIZED);
  }
}

export class ConflictError extends DomainError {
  constructor(detail: string) {
    super('conflict', detail, HttpStatus.CONFLICT);
  }
}

export class BusinessSuspendedError extends DomainError {
  constructor() {
    super('business_suspended', 'Business is suspended', HttpStatus.FORBIDDEN);
  }
}

export class ValidationError extends DomainError {
  constructor(detail: string, errors?: Record<string, string[]>) {
    super('validation', detail, HttpStatus.BAD_REQUEST);
    if (errors) {
      (this.getResponse() as ProblemDetail).errors = errors;
    }
  }
}

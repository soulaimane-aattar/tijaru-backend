import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';

import type { ProblemDetail } from '../errors';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const problem: ProblemDetail =
        typeof body === 'object' && body !== null && 'code' in body
          ? (body as ProblemDetail)
          : {
              type: `https://stock.local/errors/http-${status}`,
              title: typeof body === 'string' ? body : (body as { message?: string }).message ?? 'Error',
              status,
              code: `http_${status}`,
            };
      response.status(status).type('application/problem+json').json(problem);
      return;
    }

    this.logger.error(exception);
    const problem: ProblemDetail = {
      type: 'https://stock.local/errors/internal',
      title: 'Internal Server Error',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'internal',
    };
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).type('application/problem+json').json(problem);
  }
}

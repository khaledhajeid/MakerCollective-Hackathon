import type { ApiErrorBody, ErrorCode } from '@mc/shared';
import { hasZodFastifySchemaValidationErrors } from '@fastify/type-provider-zod';
import type { FastifyError, FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../lib/errors.js';

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  429: 'RATE_LIMITED',
};

function body(code: ErrorCode, message: string, details?: unknown): ApiErrorBody {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

/**
 * Uniform error envelope. Internal error messages and stack traces never leave
 * the server; they are logged with the request id for correlation instead.
 */
export const errorsPlugin = fp(async (app: FastifyInstance) => {
  app.setErrorHandler((err: FastifyError | AppError, request, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send(body(err.code, err.message, err.details));
    }

    if (hasZodFastifySchemaValidationErrors(err)) {
      const issues = err.validation.map((v) => ({ path: v.instancePath, message: v.message }));
      return reply.status(400).send(body('VALIDATION_FAILED', 'Request is invalid', issues));
    }

    const status = err.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      const code = STATUS_TO_CODE[status] ?? 'VALIDATION_FAILED';
      return reply.status(status).send(body(code, err.message));
    }

    request.log.error({ err }, 'unhandled error');
    return reply.status(500).send(body('INTERNAL', 'Something went wrong'));
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send(body('NOT_FOUND', 'Route not found'));
  });
});

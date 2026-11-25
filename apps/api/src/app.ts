import crypto from 'node:crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { resolveRequestActor } from './security/auth-plugin.js';
import { recordServerLog } from './services/server-log-buffer.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerDashboardRoutes } from './routes/dashboard.js';
import { registerCostCodeRoutes } from './routes/cost-codes.js';
import { registerHomesRoutes } from './routes/homes.js';
import { registerSubcontractorRoutes } from './routes/subcontractors.js';
import { registerEstimateRoutes } from './routes/estimates.js';
import { registerQuoteRoutes } from './routes/quotes.js';
import { registerPurchaseOrderRoutes } from './routes/purchase-orders.js';
import { registerBudgetRoutes } from './routes/budgets.js';
import { registerClarificationRoutes } from './routes/clarifications.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerFeedbackRoutes } from './routes/feedback.js';

declare module 'fastify' {
  interface FastifyRequest {
    correlationId: string;
    requestStartMs: number;
  }
}

export async function buildApp() {
  const app = Fastify({ logger: false, bodyLimit: 10 * 1024 * 1024 });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cookie);
  await app.register(cors, {
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'x-demo-role', 'x-demo-sub-id', 'x-request-id'],
    exposedHeaders: ['x-request-id'],
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Interstate Homes Estimating, Subcontract & Budget API',
        version: '0.1.0',
        description:
          'Phase 1 backend API covering all 81 cost codes, plan intake, estimating, subcontractor portal & compliance, DocuSeal POs, budget build, and audit log.',
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
  });

  app.get('/openapi.json', async () => app.swagger());

  app.addHook('onRequest', async (request, reply) => {
    const incomingId = request.headers['x-request-id'];
    const correlationId =
      typeof incomingId === 'string' && incomingId.trim().length > 0
        ? incomingId.trim().slice(0, 80)
        : crypto.randomUUID();
    request.correlationId = correlationId;
    request.requestStartMs = Date.now();
    reply.header('x-request-id', correlationId);
  });

  app.addHook('preHandler', async (request) => {
    request.actor = resolveRequestActor(request);
  });

  app.addHook('onError', async (request, reply, error) => {
    const durationMs = Date.now() - (request.requestStartMs || Date.now());
    recordServerLog({
      requestId: request.correlationId || 'unknown',
      method: request.method,
      route: request.url.split('?')[0] || request.url,
      statusCode: reply.statusCode >= 400 ? reply.statusCode : 500,
      durationMs,
      actorUserId: request.actor?.userId ?? null,
      errorCode: error.name,
      errorMessage: error.message,
      stack: error.stack,
    });
  });

  app.addHook('onResponse', async (request, reply) => {
    const durationMs = Date.now() - (request.requestStartMs || Date.now());
    if (reply.statusCode >= 400 || durationMs > 1500) {
      recordServerLog({
        requestId: request.correlationId || 'unknown',
        method: request.method,
        route: request.url.split('?')[0] || request.url,
        statusCode: reply.statusCode,
        durationMs,
        actorUserId: request.actor?.userId ?? null,
        errorCode: reply.statusCode >= 400 ? `HTTP_${reply.statusCode}` : 'SLOW_REQUEST',
      });
    }
  });

  app.setErrorHandler((error, request, reply) => {
    const statusCode =
      typeof (error as { statusCode?: unknown }).statusCode === 'number' &&
      (error as { statusCode: number }).statusCode >= 400 &&
      (error as { statusCode: number }).statusCode < 500
        ? (error as { statusCode: number }).statusCode
        : 500;

    if (statusCode >= 500) {
      return reply.status(500).send({
        error: 'InternalServerError',
        message: 'An unexpected error occurred while processing the request.',
        requestId: request.correlationId,
      });
    }

    const errObj = error instanceof Error ? error : null;
    return reply.status(statusCode).send({
      error: errObj?.name || 'BadRequest',
      message: errObj?.message || 'Invalid request.',
      requestId: request.correlationId,
    });
  });

  await registerHealthRoutes(app);
  await registerAuthRoutes(app);
  await registerDashboardRoutes(app);
  await registerCostCodeRoutes(app);
  await registerHomesRoutes(app);
  await registerSubcontractorRoutes(app);
  await registerEstimateRoutes(app);
  await registerQuoteRoutes(app);
  await registerPurchaseOrderRoutes(app);
  await registerBudgetRoutes(app);
  await registerClarificationRoutes(app);
  await registerAdminRoutes(app);
  await registerFeedbackRoutes(app);

  return app;
}

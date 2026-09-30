import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import { loadConfig } from "@holymedia/config";
import { createLogger, requestId } from "@holymedia/observability";
import { AppModule } from "./app.module.js";
import { ApiExceptionFilter } from "./api-exception.filter.js";
import { ReadinessService } from "./readiness.service.js";
import { requestPath } from "./infrastructure/request-path.js";
import { configureApiRouting } from "./configure-api-routing.js";

type RequestWithId = { requestId?: string };

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger("holymedia-mcp-v2-api", config.logLevel);
  const adapter = new FastifyAdapter({ bodyLimit: 3_145_728, logger: false });
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
    { bufferLogs: true },
  );

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cookie);
  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook("onRequest", async (request, reply) => {
    const requestWithId = request as typeof request & RequestWithId;
    const incoming = request.headers["x-request-id"];
    const value = Array.isArray(incoming) ? incoming[0] : incoming;
    const id = requestId(value);
    requestWithId.requestId = id;
    reply.header("x-request-id", id);
  });
  fastify.addHook("onResponse", async (request, reply) => {
    const requestWithId = request as typeof request & RequestWithId;
    const path = requestPath(request.url);
    logger.info(
      {
        requestId: requestWithId.requestId,
        method: request.method,
        path,
        status: reply.statusCode,
        ...(path === "/mcp"
          ? {
              contentType: request.headers["content-type"] ?? null,
              accept: request.headers.accept ?? null,
              userAgent: request.headers["user-agent"]?.slice(0, 160) ?? null,
              origin: request.headers.origin ?? null,
              authorizationPresent: Boolean(request.headers.authorization),
            }
          : {}),
      },
      "request complete",
    );
  });

  configureApiRouting(app);
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  if (config.environment !== "production") {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle("HolyMedia MCP v2 API")
        .setVersion("1.0")
        .build(),
    );
    SwaggerModule.setup("docs", app, document, {
      jsonDocumentUrl: "docs-json",
    });
  }

  const readiness = app.get(ReadinessService);
  app.enableShutdownHooks();
  process.once("SIGTERM", () => void readiness.close());
  process.once("SIGINT", () => void readiness.close());
  await app.listen({ port: config.apiPort, host: "0.0.0.0" });
  logger.info(
    { port: config.apiPort, environment: config.environment },
    "api started",
  );
}

void bootstrap().catch((error: unknown) => {
  const logger = createLogger("holymedia-mcp-v2-api");
  logger.fatal(
    { errorType: error instanceof Error ? error.constructor.name : "unknown" },
    "api failed to start",
  );
  process.exitCode = 1;
});

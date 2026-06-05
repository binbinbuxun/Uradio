import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // WebSocket 适配器 — 使用 Socket.IO 的 IoAdapter 才能正确处理 WS 升级
  app.useWebSocketAdapter(new IoAdapter(app));

  // CORS 配置 - 开发环境允许所有来源
  app.enableCors({
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    credentials: true,
  });

  // 全局异常过滤器
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Uradio backend running on http://localhost:${port}`);
}
bootstrap();

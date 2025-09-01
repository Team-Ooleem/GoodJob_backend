// import { NestFactory } from '@nestjs/core';
// import { AppModule } from './app.module';

// async function bootstrap() {
//     const app = await NestFactory.create(AppModule);
//     await app.listen(process.env.PORT ?? 3000);
// }
// bootstrap();


// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(cookieParser());

  // 프론트와 API 도메인이 다르면 CORS + credentials 설정
  app.enableCors({
    origin: ['https://example.com', 'http://localhost:3000'], // 프론트 도메인들
    credentials: true,
  });

  await app.listen(4000); // 예시 포트
}
bootstrap();

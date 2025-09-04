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

    app.enableCors({
        origin: ['https://example.com', 'http://localhost:3000', 'http://localhost:3001'],
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
        credentials: true,
    });

    // 모든 요청 경로에 /api prefix 추가
    app.setGlobalPrefix('api');

    await app.listen(process.env.PORT ?? 4000);
}

bootstrap();

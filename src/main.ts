// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import express from 'express';
import { AppConfigService } from './config/config.service';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);

    // ConfigService 가져오기
    const configService = app.get(AppConfigService);

    app.use(cookieParser());

    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ limit: '10mb', extended: true }));

    app.enableCors({
        origin: [
            'https://good-job.duckdns.org', // 프론트엔드 도메인 요청 허용
            'https://ai-api-good-job.duckdns.org', // AI 서버 도메인 요청 허용
            'https://example.com',
            'http://localhost:3000',
            'http://localhost:3001',
            'http://localhost:4000',
            'https://localhost:3443',
        ],
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
        credentials: true,
    });

    // 모든 요청 경로에 /api prefix 추가
    app.setGlobalPrefix('api');

    await app.listen(configService.port);
}

bootstrap();

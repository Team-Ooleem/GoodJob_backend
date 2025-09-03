import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);

    app.enableCors({
        origin: 'http://localhost:3001',
        credentials: true,
    });

    // 모든 요청 경로에 /api prefix 추가
    app.setGlobalPrefix('api');

    await app.listen(process.env.PORT ?? 3000);
}

bootstrap();

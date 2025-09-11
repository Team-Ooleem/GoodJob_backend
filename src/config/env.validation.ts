// src/config/env.validation.ts
import { plainToClass, Transform } from 'class-transformer';
import { IsString, IsNumber, IsOptional, validateSync } from 'class-validator';

class EnvironmentVariables {
    // 서버 설정
    @IsNumber()
    @IsOptional()
    @Transform(({ value }) => parseInt(value, 10))
    PORT?: number;

    @IsString()
    NODE_ENV: string;

    // 데이터베이스 설정
    @IsString()
    DB_HOST: string;

    @IsNumber()
    @Transform(({ value }) => parseInt(value, 10))
    DB_PORT: number;

    @IsString()
    DB_USERNAME: string;

    @IsString()
    DB_PASSWORD: string;

    @IsString()
    DB_DATABASE: string;

    @IsString()
    @IsOptional()
    DB_CHARSET?: string;

    @IsString()
    @IsOptional()
    DB_TIMEZONE?: string;

    // Google OAuth 설정
    @IsString()
    GOOGLE_CLIENT_ID: string;

    @IsString()
    GOOGLE_CLIENT_SECRET: string;

    @IsString()
    GOOGLE_REDIRECT_URL: string;

    // 프론트엔드 URL 설정
    @IsString()
    FRONTEND_SUCCESS_URL: string;

    // 세션 설정
    @IsString()
    SESSION_SECRET: string;

    // OpenAI 설정
    @IsString()
    OPENAI_API_KEY: string;

    // AWS 설정
    @IsString()
    AWS_ACCESS_KEY_ID: string;

    @IsString()
    AWS_SECRET_ACCESS_KEY: string;

    @IsString()
    AWS_BUCKET_NAME: string;
}

export function validate(config: Record<string, unknown>) {
    const validatedConfig = plainToClass(EnvironmentVariables, config, {
        enableImplicitConversion: true,
    });

    const errors = validateSync(validatedConfig, {
        skipMissingProperties: false,
    });

    if (errors.length > 0) {
        throw new Error(errors.toString());
    }

    return validatedConfig;
}

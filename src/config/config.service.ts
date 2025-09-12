// src/config/config.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface DatabaseConfig {
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
    charset: string;
    timezone: string;
}

interface GoogleConfig {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
}

interface FrontendConfig {
    successUrl: string;
}

interface SessionConfig {
    secret: string;
}

interface OpenAIConfig {
    apiKey: string;
}

export interface AwsConfig {
    accessKeyId: string;
    secretAccessKey: string;
    bucketName: string;
}

@Injectable()
export class AppConfigService {
    constructor(private configService: ConfigService) {}

    // 서버 설정
    get port(): number {
        return this.configService.get<number>('app.port') || 4000;
    }

    get nodeEnv(): string {
        return this.configService.get<string>('app.nodeEnv') || 'development';
    }

    // 데이터베이스 설정
    get database(): DatabaseConfig {
        return (
            this.configService.get<DatabaseConfig>('app.database') || {
                host: '',
                port: 3306,
                username: '',
                password: '',
                database: '',
                charset: 'utf8mb4',
                timezone: 'Z',
            }
        );
    }

    // Google OAuth 설정
    get google(): GoogleConfig {
        return (
            this.configService.get<GoogleConfig>('app.google') || {
                clientId: '',
                clientSecret: '',
                redirectUri: '',
            }
        );
    }

    // 프론트엔드 URL 설정
    get frontend(): FrontendConfig {
        return (
            this.configService.get<FrontendConfig>('app.frontend') || {
                successUrl: '',
            }
        );
    }

    // 세션 설정
    get session(): SessionConfig {
        return this.configService.get<SessionConfig>('app.session') || { secret: '' };
    }

    // OpenAI 설정
    get openai(): OpenAIConfig {
        return this.configService.get<OpenAIConfig>('app.openai') || { apiKey: '' };
    }

    // AWS 설정
    get aws(): AwsConfig {
        return (
            this.configService.get<AwsConfig>('app.aws') || {
                accessKeyId: '',
                secretAccessKey: '',
                bucketName: '',
            }
        );
    }

    // 개발 환경인지 확인
    get isDevelopment(): boolean {
        return this.nodeEnv === 'development';
    }

    // 프로덕션 환경인지 확인
    get isProduction(): boolean {
        return this.nodeEnv === 'production';
    }
}

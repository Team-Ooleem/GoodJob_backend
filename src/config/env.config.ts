// src/config/env.config.ts
import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
    // 서버 설정
    port: parseInt(process.env.PORT || '4000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',

    // 데이터베이스 설정
    database: {
        host: process.env.DB_HOST || '',
        port: parseInt(process.env.DB_PORT || '3306', 10),
        username: process.env.DB_USERNAME || '',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_DATABASE || '',
        charset: process.env.DB_CHARSET || 'utf8mb4',
        timezone: process.env.DB_TIMEZONE || 'Z',
    },

    // Google OAuth 설정
    google: {
        clientId: process.env.GOOGLE_CLIENT_ID || '',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
        redirectUri: process.env.GOOGLE_REDIRECT_URL || '',
    },

    // 프론트엔드 URL 설정
    frontend: {
        successUrl: process.env.FRONTEND_SUCCESS_URL || '',
    },

    // 세션 설정
    session: {
        secret: process.env.SESSION_SECRET || '',
    },

    // OpenAI 설정
    openai: {
        apiKey: process.env.OPENAI_API_KEY || '',
    },

    // AWS S3 설정
    aws: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
        bucketName: process.env.AWS_BUCKET_NAME || '',
    },

    // Pynote 설정
    pynote: {
        apiKey: process.env.HF_TOKEN || '',
        serviceUrl: process.env.AUDIO_API_BASE || 'http://localhost:8081',
    },

    // STT 설정
    stt: {
        apiKey: process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
    },

    // GCP 설정
    gcp: {
        credentials: process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
        bucketName: process.env.GCP_BUCKET_NAME || '',
    },
}));

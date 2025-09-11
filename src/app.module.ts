// 여기에 임포트해야 nestJS가 인식함
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import envConfig from './config/env.config';
import { validate } from './config/env.validation';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { DatabaseService } from './database/database.service';
import { SocialModule } from './social/social.module';
import { AuthModule } from './auth/auth.module';
// ai 면접 질문 관련 모듈
import { AiModule } from './modules/interview/interview.module';
import { CollabModule } from './modules/collab/collab.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { UsersModule } from './users/users.module';
import { ChatModule } from './chat/chat.module';
import { JobsModule } from './onboarding/jobs/jobs.module';
import { LocationsModule } from './onboarding/locations/locations.module';
import { SalariesModule } from './onboarding/salaries/salaries.module';
import { ProfileModule } from './onboarding/profile/profile.module';
import { SessionGuard } from './auth/session.guard';
// resume
import { CanvasModule } from './modules/coaching-resume/canvas.modeule';
import { AppConfigModule } from './config/config.module';

//stt 모델
import { STTModule } from './stt/stt_module';

/* gcs 모듈 */
import { GcsService } from './lib/gcs';

/* tts 모듈 */
import { TTSModule } from './tts/tts.module';
import { AvatarModule } from './modules/avatar/avatar.module';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: [`.env.${process.env.NODE_ENV || 'development'}`, '.env'],
            load: [envConfig],
            validate,
            validationOptions: {
                allowUnknown: true,
                abortEarly: true,
            },
        }),
        AppConfigModule,
        DatabaseModule,
        AuthModule,
        AiModule,
        CollabModule,
        MetricsModule,
        UsersModule,
        ChatModule,
        JobsModule,
        LocationsModule,
        SalariesModule,
        ProfileModule,
        CanvasModule,
        SocialModule,
        TTSModule,
        STTModule,
        AvatarModule,
    ],
    controllers: [AppController],
    providers: [
        AppService,
        DatabaseService,
        {
            provide: APP_GUARD,
            useClass: SessionGuard,
        },
        GcsService,
    ],
})
export class AppModule {}

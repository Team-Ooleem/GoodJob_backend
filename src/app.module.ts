// 여기에 임포트해야 nestJS가 인식함
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
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

/* stt 모듈 */
import { STTController } from './stt/stt_controller';
import { STTService } from './stt/stt_service';

/* tts 모듈 */
import { TTSModule } from './tts/tts.module';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: '.env',
        }),
        DatabaseModule,
        AuthModule,
        AiModule,
        SocialModule,
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
    ],
    controllers: [AppController, STTController],
    providers: [
        AppService,
        STTService,
        DatabaseService,
        {
            provide: APP_GUARD,
            useClass: SessionGuard,
        },
    ],
})
export class AppModule {}

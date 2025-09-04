// 여기에 임포트해야 nestJS가 인식함
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { SocialModule } from './social/social.module';
import { AuthModule } from './auth/auth.module';
// ai 면접 질문 관련 모듈
import { AiModule } from './ai/ai.module';
import { CollabModule } from './modules/collab/collab.module';
import { UsersModule } from './users/users.module';

/* stt 모듈 */
import { STTController } from './stt/stt_controller';
import { STTService } from './stt/stt_service';

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
        UsersModule,
    ],
    controllers: [AppController, STTController],
    providers: [AppService, STTService],
})
export class AppModule {}

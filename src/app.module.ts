// 여기에 임포트해야 nestJS가 인식함
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { SocialModule } from './social/social.module';
import { AuthModule } from './auth/auth.module';
// ai 면접 질문 관련 모듈
import { AiModule } from './modules/interview/interview.module';
import { CollabModule } from './modules/collab/collab.module';
//import { UsersModule } from './users/users.module';
import { MetricsModule } from './modules/metrics/metrics.module';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: '.env',
        }),
        DatabaseModule,
        AuthModule,
        AiModule,
        DatabaseModule,
        SocialModule,
        CollabModule,
        //UsersModule,
        MetricsModule,
    ],
    controllers: [AppController],
    providers: [AppService],
})
export class AppModule {}

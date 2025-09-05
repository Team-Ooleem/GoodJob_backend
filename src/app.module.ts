// 여기에 임포트해야 nestJS가 인식함
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
// ai 면접 질문 관련 모듈
import { AiModule } from './ai/ai.module';
import { CollabModule } from './modules/collab/collab.module';
import { UsersModule } from './users/users.module';
// [로그인] 채용 직군/직무 관련 API 모듈
import { JobsModule } from './jobs/jobs.module';
// [로그인] 희망 근무지 관련 API 모듈
import { LocationsModule } from './locations/locations.module';
// [로그인] 희망 연봉 관련 API 모듈
import { SalariesModule } from './salaries/salaries.module';
// [로그인] 프로필 (한 줄 소개+간단 소개글) 관련 API 모듈
import { ProfileModule } from './profile/profile.module';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: '.env',
        }),
        DatabaseModule,
        AuthModule,
        AiModule,
        CollabModule,
        UsersModule,
        JobsModule,
        LocationsModule,
        SalariesModule,
        ProfileModule,
    ],
    controllers: [AppController],
    providers: [AppService],
})
export class AppModule {}

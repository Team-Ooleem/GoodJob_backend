import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { DatabaseModule } from '../database/database.module';

@Module({
    imports: [DatabaseModule], // 데이터베이스 연결을 위해 임포트
    controllers: [JobsController], // HTTP 요청을 처리할 컨트롤러 등록
    providers: [JobsService], // 서비스 등록
    exports: [JobsService], // 다른 모듈에서 사용할 수 있도록 서비스 내보내기
})
export class JobsModule {}

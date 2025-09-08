import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { AppConfigService } from './config.service';

@Global()
@Module({
    imports: [NestConfigModule],
    providers: [AppConfigService],
    exports: [AppConfigService],
})
export class AppConfigModule {}

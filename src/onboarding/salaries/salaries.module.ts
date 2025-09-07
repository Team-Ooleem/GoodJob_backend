import { Module } from '@nestjs/common';
import { SalariesController } from './salaries.controller';
import { SalariesService } from './salaries.service';
import { DatabaseModule } from '../../database/database.module';

@Module({
    imports: [DatabaseModule],
    controllers: [SalariesController],
    providers: [SalariesService],
    exports: [SalariesService],
})
export class SalariesModule {}

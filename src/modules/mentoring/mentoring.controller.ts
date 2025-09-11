import { Controller, Get } from '@nestjs/common';
import { MentoringService } from './mentoring.service';
import { GetMentoringExampleResponseDto } from './dto/get-example.dto';

@Controller('mentoring')
export class MentoringController {
    constructor(private readonly mentoringService: MentoringService) {}

    @Get()
    getExample(): GetMentoringExampleResponseDto {
        return this.mentoringService.getExample();
    }
}


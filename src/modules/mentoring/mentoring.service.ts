import { Injectable } from '@nestjs/common';
import { GetMentoringExampleResponseDto } from './dto/get-example.dto';

@Injectable()
export class MentoringService {
    getExample(): GetMentoringExampleResponseDto {
        return { value: 1 };
    }
}


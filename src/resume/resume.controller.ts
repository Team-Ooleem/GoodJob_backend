import {
    Controller,
    Get,
    Post,
    Body,
    Patch,
    Param,
    Delete,
    UseGuards,
    Req,
    ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { ResumeService } from './resume.service';
import { CreateResumeDto } from './dto/create-resume.dto';
import { UpdateResumeDto } from './dto/update-resume.dto';
import { ResumeListResponseDto } from './dto/resume-list-response.dto';
import { ResumeDetailResponseDto } from './dto/resume-detail-response.dto';

@ApiTags('Resume')
@Controller('resumes')
export class ResumeController {
    constructor(private readonly resumeService: ResumeService) {}

    @Post()
    @ApiOperation({ summary: '새 이력서 생성' })
    @ApiResponse({ status: 201, description: '이력서가 성공적으로 생성되었습니다.' })
    @ApiResponse({ status: 400, description: '잘못된 요청입니다.' })
    async create(@Body() createResumeDto: CreateResumeDto, @Req() req: any) {
        // 실제로는 JWT 토큰에서 userId를 가져와야 함
        const userId = req.user?.id || 1; // 임시로 하드코딩
        return this.resumeService.create(createResumeDto, userId);
    }

    @Get('user/:userId')
    @ApiOperation({ summary: '특정 사용자의 이력서 목록 조회' })
    @ApiParam({ name: 'userId', description: '사용자 ID', type: 'number' })
    @ApiResponse({
        status: 200,
        description: '이력서 목록을 성공적으로 조회했습니다.',
        type: [ResumeListResponseDto],
    })
    @ApiResponse({ status: 404, description: '사용자를 찾을 수 없습니다.' })
    async findByUserId(
        @Param('userId', ParseIntPipe) userId: number,
    ): Promise<ResumeListResponseDto[]> {
        return this.resumeService.findByUserId(userId);
    }

    @Get(':id')
    @ApiOperation({ summary: '특정 이력서 상세 조회' })
    @ApiParam({ name: 'id', description: '이력서 ID', type: 'number' })
    @ApiResponse({
        status: 200,
        description: '이력서를 성공적으로 조회했습니다.',
        type: ResumeDetailResponseDto,
    })
    @ApiResponse({ status: 404, description: '이력서를 찾을 수 없습니다.' })
    async findOne(@Param('id', ParseIntPipe) id: number): Promise<ResumeDetailResponseDto> {
        return this.resumeService.findOne(id);
    }

    @Patch(':id')
    @ApiOperation({ summary: '이력서 수정' })
    @ApiParam({ name: 'id', description: '이력서 ID', type: 'number' })
    @ApiResponse({ status: 200, description: '이력서가 성공적으로 수정되었습니다.' })
    @ApiResponse({ status: 404, description: '이력서를 찾을 수 없습니다.' })
    @ApiResponse({ status: 403, description: '권한이 없습니다.' })
    async update(
        @Param('id', ParseIntPipe) id: number,
        @Body() updateResumeDto: UpdateResumeDto,
        @Req() req: any,
    ) {
        const userId = req.user?.id || 1; // 임시로 하드코딩
        return this.resumeService.update(id, updateResumeDto, userId);
    }

    @Delete(':id')
    @ApiOperation({ summary: '이력서 삭제' })
    @ApiParam({ name: 'id', description: '이력서 ID', type: 'number' })
    @ApiResponse({ status: 200, description: '이력서가 성공적으로 삭제되었습니다.' })
    @ApiResponse({ status: 404, description: '이력서를 찾을 수 없습니다.' })
    @ApiResponse({ status: 403, description: '권한이 없습니다.' })
    async remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
        const userId = req.user?.id || 1; // 임시로 하드코딩
        return this.resumeService.remove(id, userId);
    }
}

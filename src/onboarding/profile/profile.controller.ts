import {
    Controller,
    Get,
    Put,
    Post,
    Body,
    Req,
    UnauthorizedException,
    UseInterceptors,
    UploadedFile,
    BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import * as jwt from 'jsonwebtoken';
import { ProfileService } from './profile.service';
import { uploadFileToS3, validateImageFile, generateS3Key } from '../../lib/s3';

@Controller('profile')
export class ProfileController {
    constructor(private readonly profileService: ProfileService) {}

    @Get('me')
    async getProfile(@Req() req: Request) {
        const userId = this.getUserIdFromToken(req);
        return this.profileService.getProfile(userId);
    }

    @Put('me')
    async updateProfile(
        @Req() req: Request,
        @Body() updateData: { short_bio?: string; bio?: string; profile_img?: string },
    ) {
        const userId = this.getUserIdFromToken(req);
        return this.profileService.updateProfile(userId, updateData);
    }

    @Post('upload-image')
    @UseInterceptors(FileInterceptor('image'))
    async uploadProfileImage(@Req() req: Request, @UploadedFile() file: Express.Multer.File) {
        const userId = this.getUserIdFromToken(req);

        // 파일 유효성 검사
        const validation = validateImageFile(file);
        if (!validation.isValid) {
            throw new BadRequestException(validation.error);
        }

        try {
            // S3 키 생성
            const s3Key = generateS3Key(file.originalname, 'profile-images');

            // S3에 이미지 업로드
            const uploadResult = await uploadFileToS3(file.buffer, s3Key, file.mimetype);

            if (!uploadResult.success) {
                throw new BadRequestException(`이미지 업로드 실패: ${uploadResult.error}`);
            }

            // 프로필에 이미지 URL 저장
            await this.profileService.updateProfile(userId, {
                profile_img: uploadResult.url,
            });

            return {
                success: true,
                message: '프로필 이미지가 업로드되었습니다.',
                imageUrl: uploadResult.url,
            };
        } catch (error) {
            if (error instanceof BadRequestException) {
                throw error;
            }
            throw new BadRequestException('이미지 업로드 중 오류가 발생했습니다.');
        }
    }

    private getUserIdFromToken(req: Request): number {
        const token = req.cookies?.session;
        if (!token) {
            throw new UnauthorizedException('로그인이 필요합니다.');
        }

        try {
            const payload = jwt.verify(token, process.env.SESSION_SECRET!) as any;
            return payload.idx;
        } catch {
            throw new UnauthorizedException('유효하지 않은 토큰입니다.');
        }
    }
}

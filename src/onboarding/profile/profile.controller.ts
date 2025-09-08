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
import { uploadFileToS3, validateImageFile, generateS3Key } from '@/lib/s3';
import { DatabaseService } from '@/database/database.service';
import { AppConfigService } from '@/config/config.service';

@Controller('profile')
export class ProfileController {
    constructor(
        private readonly profileService: ProfileService,
        private readonly databaseService: DatabaseService,
        private readonly configService: AppConfigService,
    ) {}

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
            const uploadResult = await uploadFileToS3(
                file.buffer,
                s3Key,
                file.mimetype,
                this.configService.aws,
            );

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

    // 온보딩 데이터 조회
    @Get('onboarding-data')
    async getOnboardingData(@Req() req: Request) {
        const userId = this.getUserIdFromToken(req);

        try {
            // 사용자의 온보딩 데이터 조회
            const result = await this.databaseService.query(
                'SELECT * FROM individual_profile WHERE user_idx = ?',
                [userId],
            );

            return {
                success: true,
                data: result[0] || null,
                message: result[0] ? '온보딩 데이터를 조회했습니다.' : '온보딩 데이터가 없습니다.',
            };
        } catch (error) {
            console.error('온보딩 데이터 조회 중 오류:', error);
            throw new BadRequestException('온보딩 데이터 조회 중 오류가 발생했습니다.');
        }
    }

    // 온보딩 완료 처리
    @Post('complete-onboarding')
    async completeOnboarding(
        @Req() req: Request,
        @Body()
        onboardingData: {
            desired_job: number;
            desired_sido: string;
            desired_gu: string;
            desired_salary: number;
        },
    ) {
        const userId = this.getUserIdFromToken(req);

        // 데이터 유효성 검사
        if (!onboardingData) {
            throw new BadRequestException('요청 데이터가 없습니다.');
        }

        if (
            !onboardingData.desired_job ||
            !onboardingData.desired_sido ||
            !onboardingData.desired_gu ||
            !onboardingData.desired_salary
        ) {
            throw new BadRequestException(
                '필수 필드가 누락되었습니다. (desired_job, desired_sido, desired_gu, desired_salary)',
            );
        }

        try {
            console.log('🔍 [온보딩 완료] 사용자 ID:', userId);
            console.log('🔍 [온보딩 완료] 온보딩 데이터:', onboardingData);

            // 1) individual_profile 테이블에 사용자 선호 정보 저장
            await this.databaseService.query(
                `INSERT INTO individual_profile (user_idx, desired_job, desired_sido, desired_gu, desired_salary) 
                 VALUES (?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE 
                 desired_job = VALUES(desired_job),
                 desired_sido = VALUES(desired_sido),
                 desired_gu = VALUES(desired_gu),
                 desired_salary = VALUES(desired_salary)`,
                [
                    userId,
                    onboardingData.desired_job,
                    onboardingData.desired_sido,
                    onboardingData.desired_gu,
                    onboardingData.desired_salary,
                ],
            );

            // 2) users 테이블의 is_onboarded 플래그를 1로 업데이트
            await this.databaseService.query(
                'UPDATE users SET is_onboarded = 1, updated_at = NOW() WHERE idx = ?',
                [userId],
            );

            console.log('✅ [온보딩 완료] 성공:', userId);

            return {
                success: true,
                message: '온보딩이 완료되었습니다.',
                data: {
                    user_idx: userId,
                    is_onboarded: true,
                    onboarding_data: onboardingData,
                },
            };
        } catch (error) {
            console.error('온보딩 완료 처리 중 오류:', error);
            throw new BadRequestException('온보딩 완료 처리 중 오류가 발생했습니다.');
        }
    }

    private getUserIdFromToken(req: Request): number {
        const token = req.cookies?.session;
        if (!token) {
            throw new UnauthorizedException('로그인이 필요합니다.');
        }

        try {
            const payload = jwt.verify(token, this.configService.session.secret) as any;
            return payload.idx;
        } catch {
            throw new UnauthorizedException('유효하지 않은 토큰입니다.');
        }
    }
}

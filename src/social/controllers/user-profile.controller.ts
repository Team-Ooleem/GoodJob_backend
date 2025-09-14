import {
    Controller,
    Get,
    Post,
    HttpException,
    HttpStatus,
    Req,
    Param,
    ParseIntPipe,
    UploadedFile,
    UseInterceptors,
    BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import {
    UserProfileService,
    MyProfileInfo,
    UserProfileInfo,
} from '../services/user-profile.service';

interface AuthenticatedRequest extends Request {
    user_idx: number;
}

@Controller('social/profile')
export class UserProfileController {
    constructor(private readonly userProfileService: UserProfileService) {}

    /**
     * 내 정보 조회 (간단한 정보만)
     * GET /social/profile/me
     */
    @Get('me')
    async getMyProfile(@Req() req: AuthenticatedRequest): Promise<MyProfileInfo> {
        const currentUserId = req.user_idx;
        try {
            const myProfile = await this.userProfileService.getMyProfileInfo(currentUserId);
            return myProfile;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

            // 사용자를 찾을 수 없는 경우 (404 Not Found)
            if (errorMessage.includes('사용자를 찾을 수 없습니다')) {
                throw new HttpException(
                    {
                        status: HttpStatus.NOT_FOUND,
                        error: errorMessage,
                    },
                    HttpStatus.NOT_FOUND,
                );
            }

            // 기타 서버 오류 (500 Internal Server Error)
            throw new HttpException(
                {
                    status: HttpStatus.INTERNAL_SERVER_ERROR,
                    error: errorMessage,
                },
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    /**
     * 특정 사용자 프로필 조회
     * GET /social/profile/:userId
     */
    @Get(':userId')
    async getUserProfile(
        @Req() req: AuthenticatedRequest,
        @Param('userId', ParseIntPipe) userId: number,
    ): Promise<UserProfileInfo> {
        const currentUserId = req.user_idx;
        try {
            const userProfile = await this.userProfileService.getUserProfileInfo(
                currentUserId,
                userId,
            );
            return userProfile;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

            // 사용자를 찾을 수 없는 경우 (404 Not Found)
            if (errorMessage.includes('사용자를 찾을 수 없습니다')) {
                throw new HttpException(
                    {
                        status: HttpStatus.NOT_FOUND,
                        error: errorMessage,
                    },
                    HttpStatus.NOT_FOUND,
                );
            }

            // 기타 서버 오류 (500 Internal Server Error)
            throw new HttpException(
                {
                    status: HttpStatus.INTERNAL_SERVER_ERROR,
                    error: errorMessage,
                },
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    /**
     * 내 프로필 이미지 업로드
     * POST /social/profile/me/image
     */
    @Post('me/image')
    @UseInterceptors(FileInterceptor('file'))
    async uploadMyProfileImage(
        @Req() req: AuthenticatedRequest,
        @UploadedFile() file: Express.Multer.File,
    ) {
        if (!file) {
            throw new BadRequestException('파일이 필요합니다.');
        }

        const currentUserId = req.user_idx;
        try {
            const result = await this.userProfileService.uploadProfileImage(currentUserId, file);
            return result;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            throw new HttpException(
                {
                    status: HttpStatus.INTERNAL_SERVER_ERROR,
                    error: errorMessage,
                },
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }
}

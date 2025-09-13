import { Controller, Get, HttpException, HttpStatus, Req } from '@nestjs/common';
import type { Request } from 'express';
import { UserProfileService, MyProfileInfo } from '../services/user-profile.service';

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
}

import { Controller, Get, Param, ParseIntPipe, HttpException, HttpStatus } from '@nestjs/common';
import { UserProfileService, UserProfileInfo } from '../services/user-profile.service';

@Controller('social/profile')
export class UserProfileController {
    constructor(private readonly userProfileService: UserProfileService) {}

    /**
     * 사용자 프로필 정보 조회
     * GET /social/profile/:userId
     */
    @Get(':userId')
    async getUserProfile(@Param('userId', ParseIntPipe) userId: number): Promise<UserProfileInfo> {
        try {
            const userProfile = await this.userProfileService.getUserProfileInfo(userId);

            // 성공 응답 (200 OK)
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
}

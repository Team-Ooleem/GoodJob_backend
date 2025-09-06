import { Controller, Get, Put, Body, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import * as jwt from 'jsonwebtoken';
import { ProfileService } from './profile.service';

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
        @Body() updateData: { short_bio?: string; bio?: string },
    ) {
        const userId = this.getUserIdFromToken(req);
        return this.profileService.updateProfile(userId, updateData);
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

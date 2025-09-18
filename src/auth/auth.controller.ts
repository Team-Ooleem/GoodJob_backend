// src/auth/auth.controller.ts
import { Controller, Get, Query, Res, Req } from '@nestjs/common';
import type { Response, Request } from 'express';
import axios from 'axios';
import * as jwt from 'jsonwebtoken';
import { DatabaseService } from '@/database/database.service';
import { AppConfigService } from '@/config/config.service';

@Controller('auth')
export class AuthController {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly configService: AppConfigService,
    ) {}
    // 프론트에서 구글로 로그인 버튼 누르면 이동하는 엔드포인트
    @Get('google')
    async redirectToGoogle(@Res() res: Response, @Req() req: Request) {
        const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        url.searchParams.set('client_id', this.configService.google.clientId);
        url.searchParams.set('redirect_uri', this.configService.google.redirectUri);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('scope', 'openid email profile');

        // CSRF 방지용 state (데모: 고정값 대신 랜덤 생성 후 세션/스토리지에 저장 권장)
        url.searchParams.set('state', 'state-1234');

        return res.redirect(url.toString());
    }

    // 구글 로그인 완료 후 Google 서버가 돌려주는 콜백 엔드포인트
    @Get('google/callback')
    async googleCallback(
        @Query('code') code: string,
        @Query('state') state: string,
        @Res() res: Response,
    ) {
        // 1) (권장) state 검증 로직 추가
        // if (state !== expected) throw new UnauthorizedException();

        // 2) code → 토큰 교환
        const tokenRes = await axios.post('https://oauth2.googleapis.com/token', null, {
            params: {
                client_id: this.configService.google.clientId,
                client_secret: this.configService.google.clientSecret,
                code,
                redirect_uri: this.configService.google.redirectUri,
                grant_type: 'authorization_code',
            },
        });

        const { id_token, access_token } = tokenRes.data;

        // 3) 유저 정보
        // (A) id_token 디코드해서 sub/email 꺼내기
        const decoded: any = jwt.decode(id_token);
        // (B) 또는 userinfo 호출
        // const { data: profile } = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
        //   headers: { Authorization: `Bearer ${access_token}` },
        // });

        // 4) DB에 사용자 정보 저장/조회 후 idx 가져오기
        const userIdx = await this.createOrGetUser(decoded);

        // 5) 우리 서버 세션(JWT) 발급 (idx 포함)
        const sessionJwt = jwt.sign(
            {
                idx: userIdx, // 우리 DB의 사용자 idx
                sub: decoded.sub, // 구글 사용자 고유 ID
                email: decoded.email,
                name: decoded.name,
                picture: decoded.picture,
                iss: 'goodjob-api',
            },
            this.configService.session.secret,
            { expiresIn: '7d' },
        );

        // 5) HttpOnly 쿠키로 세션 전달
        const isProd = this.configService.isProduction;

        // 환경에 따른 쿠키 설정
        const cookieOptions = {
            httpOnly: true,
            path: '/',
            maxAge: 7 * 24 * 60 * 60 * 1000,
            // 프로덕션 환경 (HTTPS, 크로스 도메인)
            ...(isProd && {
                secure: true,
                sameSite: 'none' as const, // 크로스 도메인에는 none이 필요
                domain: '.good-job.shop',
            }),
            // 로컬 환경 (HTTP, 같은 도메인)
            ...(!isProd && {
                secure: false,
                sameSite: 'lax' as const,
                // domain 설정 없음 (기본값 사용)
            }),
        };

        res.cookie('session', sessionJwt, cookieOptions);

        // 쿠키 설정 디버깅 로그
        console.log('🍪 [AUTH] 쿠키 설정 완료:', {
            isProd,
            cookieOptions,
            domain: cookieOptions.domain,
            secure: cookieOptions.secure,
            sameSite: cookieOptions.sameSite,
        });

        // 6) 로그인 완료 후 메인 페이지로 리다이렉트
        return res.redirect(`${this.configService.frontend.successUrl}`);
    }

    // 쿠키 설정 상태 확인 (인증 불필요)
    @Get('cookie-check')
    async checkCookie(@Req() req: Request) {
        const token = req.cookies?.session;
        return {
            hasCookie: !!token,
            cookieExists: !!token,
            timestamp: new Date().toISOString(),
        };
    }

    // 클라이언트가 로그인 여부 확인할 때 호출
    // 쿠키(session) 안의 jwt 검증해서 로그인 상태와 유저 정보, 온보딩 상태 반환
    @Get('me')
    async me(@Req() req: Request) {
        const token = req.cookies?.session;
        const isOnboarded = true; // 완전 임시(온보딩 삭제예정)
        if (!token) return { authenticated: false };

        try {
            const payload = jwt.verify(token, this.configService.session.secret) as any;

            return {
                authenticated: true,
                user: {
                    idx: payload.idx, // 우리 DB의 사용자 idx
                    id: payload.sub, // 구글 사용자 고유 ID
                    email: payload.email,
                    name: payload.name,
                    picture: payload.picture,
                },
            };
        } catch {
            return { authenticated: false };
        }
    }

    // 로그아웃 엔드포인트, 세션 쿠키 삭제
    @Get('logout')
    logout(@Res() res: Response) {
        const isProd = this.configService.isProduction;

        // 로그인 시와 동일한 쿠키 옵션으로 삭제
        const cookieOptions = {
            path: '/',
            // 프로덕션 환경 (HTTPS, 크로스 도메인)
            ...(isProd && {
                secure: true,
                sameSite: 'none' as const,
                domain: '.good-job.shop',
            }),
            // 로컬 환경 (HTTP, 같은 도메인)
            ...(!isProd && {
                secure: false,
                sameSite: 'lax' as const,
            }),
        };

        res.clearCookie('session', cookieOptions);
        return res.status(204).send();
    }

    // 구글 로그인 사용자 생성/조회 메서드
    private async createOrGetUser(decoded: any): Promise<number> {
        try {
            // 1) email로 기존 사용자 확인
            const existingUsers = await this.databaseService.query(
                'SELECT idx FROM users WHERE email = ?',
                [decoded.email],
            );

            if (existingUsers.length > 0) {
                // 기존 사용자가 있으면 idx 반환
                const userIdx = existingUsers[0].idx;

                // social_account 테이블에 구글 정보가 있는지 확인
                const socialAccounts = await this.databaseService.query(
                    'SELECT * FROM social_account WHERE user_idx = ? AND provider_id = ?',
                    [userIdx, decoded.sub],
                );

                // social_account에 구글 정보가 없으면 추가
                if (socialAccounts.length === 0) {
                    await this.databaseService.query(
                        'INSERT INTO social_account (user_idx, provider_id, created_at) VALUES (?, ?, NOW())',
                        [userIdx, decoded.sub],
                    );
                }

                return userIdx;
            }

            // 2) 새 사용자 생성
            const insertResult = await this.databaseService.query(
                'INSERT INTO users (name, phone, email, created_at) VALUES (?, ?, ?, NOW())',
                [decoded.name || 'Unknown', '', decoded.email], // phone을 빈 문자열로 설정
            );

            // MySQL insertId 가져오기
            const userIdx = (insertResult as any).insertId;

            // 3) social_account 테이블에 구글 정보 저장
            await this.databaseService.query(
                'INSERT INTO social_account (user_idx, provider_id, created_at) VALUES (?, ?, NOW())',
                [userIdx, decoded.sub],
            );

            return userIdx;
        } catch (error) {
            console.error('사용자 생성/조회 오류:', error);
            throw new Error('사용자 정보 처리 중 오류가 발생했습니다.');
        }
    }
}

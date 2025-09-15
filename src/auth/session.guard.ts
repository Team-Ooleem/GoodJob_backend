import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { AppConfigService } from '@/config/config.service';

@Injectable()
export class SessionGuard implements CanActivate {
    constructor(private readonly configService: AppConfigService) {}

    canActivate(ctx: ExecutionContext): boolean {
        const req = ctx.switchToHttp().getRequest();

        // 디버깅용 로그 - 요청 정보 출력
        console.log('🔍 [SessionGuard] 요청 정보:');
        console.log('  - Path:', req.path);
        console.log('  - Method:', req.method);
        console.log('  - Headers:', JSON.stringify(req.headers, null, 2));
        console.log('  - Cookies:', JSON.stringify(req.cookies, null, 2));
        console.log('  - Raw Headers:', req.rawHeaders);

        // 인증이 필요하지 않은 경로들
        const publicPaths = [
            '/api/auth/google',
            '/api/auth/google/callback',
            '/api/auth/logout',
            '/api/auth/me',
            '/api/auth/cookie-check',
            '/api/mentoring-products',
        ];

        if (
            publicPaths.includes(req.path) ||
            (req.path as string).startsWith('/api/stt/') ||
            // TODO: mentoring-products는 임시로 공개 허용. 로그인 연동 후 제거할 것.
            (req.path as string).startsWith('/api/mentoring-products/') ||
            (req.path as string) === '/api/mentoring-products' ||
            // TODO: social/posts/user 엔드포인트 임시 공개. 로그인 연동 후 제거할 것.
            (req.path as string).startsWith('/api/social/posts/user') ||
            // TODO: mentors 엔드포인트(리뷰 등) 임시 공개. 인증 연동 후 제거할 것.
            (req.path as string).startsWith('/api/mentors/') ||
            // TODO: mentees 엔드포인트(신청 조회) 임시 공개. 인증 연동 후 제거할 것.
            (req.path as string).startsWith('/api/mentees/') ||
            // TODO: mentoring-applications 임시 공개. 인증 연동 후 제거할 것.
            (req.path as string).startsWith('/api/mentoring-applications/')
        ) {
            // 비로그인 접근 시, 의존 로직을 위해 guest 사용자 idx를 0으로 설정
            if (!req.user_idx) {
                req.user_idx = 0;
            }
            console.log('✅ [SessionGuard] 공개 경로로 인증 생략');
            return true;
        }

        const token = req.cookies?.session;
        console.log('🍪 [SessionGuard] 세션 토큰:', token ? '존재함' : '없음');

        if (!token) {
            console.log('❌ [SessionGuard] 세션 쿠키가 없습니다');
            throw new UnauthorizedException(); // 쿠키 없음 → 401
        }

        try {
            const payload = jwt.verify(token, this.configService.session.secret) as any;
            console.log('✅ [SessionGuard] 토큰 검증 성공:', {
                idx: payload.idx,
                email: payload.email,
                name: payload.name,
            });

            req.user = payload; // 컨트롤러에서 req.user 사용 가능
            req.user_idx = payload.idx; // DB 저장용 user_idx 추가
            return true;
        } catch (error) {
            console.log('❌ [SessionGuard] 토큰 검증 실패:', error.message);
            throw new UnauthorizedException(); // 만료/위조 → 401
        }
    }
}

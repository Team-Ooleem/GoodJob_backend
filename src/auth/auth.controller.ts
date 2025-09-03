// src/auth/auth.controller.ts
import { Controller, Get, Query, Res, Req } from '@nestjs/common';
import type { Response, Request } from 'express';
import axios from 'axios';
import * as jwt from 'jsonwebtoken';

@Controller('auth')
export class AuthController {
  // 프론트에서 구글로 로그인 버튼 누르면 이동하는 엔드포인트
  @Get('google')
  async redirectToGoogle(@Res() res: Response, @Req() req: Request) {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID!);
    url.searchParams.set('redirect_uri', process.env.GOOGLE_REDIRECT_URI!);
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
    const tokenRes = await axios.post(
      'https://oauth2.googleapis.com/token',
      null,
      {
        params: {
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          code,
          redirect_uri: process.env.GOOGLE_REDIRECT_URI,
          grant_type: 'authorization_code',
        },
      },
    );

    const { id_token, access_token } = tokenRes.data;

    // 3) 유저 정보
    // (A) id_token 디코드해서 sub/email 꺼내기
    const decoded: any = jwt.decode(id_token);
    // (B) 또는 userinfo 호출
    // const { data: profile } = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
    //   headers: { Authorization: `Bearer ${access_token}` },
    // });

    // 4) DB upsert(여기선 스킵) 후, 우리 서버 세션(JWT) 발급
    const sessionJwt = jwt.sign(
      {
        sub: decoded.sub,         // 구글 사용자 고유 ID
        email: decoded.email,
        name: decoded.name,
        picture: decoded.picture,
        iss: 'goodjob-api',
      },
      process.env.SESSION_SECRET!,
      { expiresIn: '7d' },
    );

    // 5) HttpOnly 쿠키로 세션 전달
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie('session', sessionJwt, {
      httpOnly: true,
      secure: isProd,           // 개발환경: false, 운영환경: true
      sameSite: 'lax',   // 프론트/백이 같은 사이트면 Lax로 충분
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // 6) 프론트로 리다이렉트
    // return res.redirect('http://localhost:3000');     // 배포 전이라 일단 홈으로 리다이렉트
    return res.redirect(process.env.FRONTEND_SUCCESS_URL ?? 'http://localhost:3000');

  }

  // 클라이언트가 로그인 여부 확인할 때 호출
  // 쿠키(session) 안의 jwt 검증해서 로그인 상태와 유저 정보 반환
  @Get('me')
  async me(@Req() req: Request) {
    const token = req.cookies?.session;
    if (!token) return { authenticated: false };

    try {
      const payload = jwt.verify(token, process.env.SESSION_SECRET!) as any;
      return {
        authenticated: true,
        user: {
          id: payload.sub,
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
    res.clearCookie('session', { path: '/' });
    return res.status(204).send();
  }
}

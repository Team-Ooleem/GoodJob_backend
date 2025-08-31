# 라이브러리 목록 및 역할

## Dependencies (프로덕션 의존성)

### NestJS 관련

- **@nestjs/common**: NestJS의 핵심 데코레이터, 인터페이스, 유틸리티 클래스들을 제공
- **@nestjs/core**: NestJS 애플리케이션의 핵심 기능과 DI 컨테이너를 담당
- **@nestjs/platform-express**: Express.js와 NestJS를 연결하는 어댑터
- **@nestjs/config**: 환경 변수와 설정 파일을 관리하는 모듈
- **@nestjs/passport**: Passport.js 인증 전략을 NestJS와 통합
- **@nestjs/swagger**: API 문서화를 위한 Swagger/OpenAPI 통합
- **@nestjs/axios**: HTTP 클라이언트 요청을 위한 Axios 래퍼

### 인증 및 보안

- **passport**: Node.js용 인증 미들웨어
- **passport-jwt**: JWT 토큰 기반 인증 전략
- **bcrypt**: 비밀번호 해싱 및 검증을 위한 암호화 라이브러리
- **helmet**: 보안 헤더를 설정하여 일반적인 웹 취약점을 방지

### 유틸리티

- **axios**: HTTP 클라이언트 라이브러리
- **cors**: Cross-Origin Resource Sharing 설정
- **cache-manager**: 다양한 캐시 저장소를 위한 통합 인터페이스
- **class-transformer**: 일반 객체를 클래스 인스턴스로 변환
- **class-validator**: 클래스 기반 유효성 검사 데코레이터
- **reflect-metadata**: TypeScript 메타데이터 리플렉션 지원
- **rxjs**: 반응형 프로그래밍을 위한 라이브러리
- **swagger-ui-express**: Swagger UI를 Express 앱에 통합

## DevDependencies (개발 의존성)

### 개발 도구

- **@nestjs/cli**: NestJS 프로젝트 생성 및 관리 CLI 도구
- **@nestjs/schematics**: NestJS 코드 생성 스키마틱
- **@nestjs/testing**: NestJS 애플리케이션 테스트를 위한 유틸리티
- **typescript**: JavaScript의 정적 타입 검사 및 컴파일러
- **ts-node**: TypeScript 파일을 직접 실행할 수 있게 해주는 도구
- **ts-loader**: Webpack에서 TypeScript 파일을 처리하는 로더

### 코드 품질

- **eslint**: JavaScript/TypeScript 코드 품질 검사 및 수정
- **prettier**: 코드 포맷팅 도구
- **eslint-config-prettier**: ESLint와 Prettier 간의 충돌 방지
- **eslint-plugin-prettier**: Prettier를 ESLint 규칙으로 실행

### 테스트

- **jest**: JavaScript 테스트 프레임워크
- **ts-jest**: Jest에서 TypeScript 파일을 테스트할 수 있게 해주는 프리프로세서
- **supertest**: HTTP 서버 테스트를 위한 라이브러리
- **@types/jest**: Jest 타입 정의
- **@types/supertest**: Supertest 타입 정의

### 타입 정의

- **@types/bcrypt**: bcrypt 라이브러리의 TypeScript 타입 정의
- **@types/cors**: cors 라이브러리의 TypeScript 타입 정의
- **@types/express**: Express.js의 TypeScript 타입 정의
- **@types/node**: Node.js의 TypeScript 타입 정의
- **@types/passport-jwt**: passport-jwt의 TypeScript 타입 정의

### 기타

- **source-map-support**: 소스맵 지원으로 디버깅 개선
- **tsconfig-paths**: TypeScript 경로 매핑 지원
- **globals**: 전역 변수 타입 정의

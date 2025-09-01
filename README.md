# Good Job Nest

NestJS 기반의 백엔드 프로젝트입니다.

## 🚀 시작하기

### 필수 요구사항

- **Node.js**: `22.19.0` (정확한 버전 필수)
- **패키지 매니저**: `pnpm` (npm, yarn 사용 금지)
- **MySQL**: `8.0` 이상

### Node.js 버전 확인

```bash
node --version
# v22.19.0이어야 합니다
```

### pnpm 설치 (아직 설치되지 않은 경우)

```bash
npm install -g pnpm
```

## 📦 의존성 설치

```bash
pnpm install
```

## 🗄️ 데이터베이스 설정

### 자동 설정 (권장)

범용 스크립트가 운영체제를 자동으로 감지하여 적절한 방법으로 데이터베이스를 설정합니다.

```bash
# 범용 스크립트 (운영체제 자동 감지)
pnpm run db:setup
```

### 환경 변수 설정

**⚠️ 중요: 데이터베이스 자동 설정을 사용하려면 반드시 `.env` 파일이 필요합니다.**

애플리케이션 실행을 위해 `.env` 파일을 생성하고 데이터베이스 연결 정보를 설정하세요.

```bash
cp env.example .env
```

그 후 `.env` 파일에서 데이터베이스 연결 정보를 수정하세요:

```env
# 데이터베이스 설정
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password_here
DB_NAME=good_job
```

**참고**: `.env` 파일이 없으면 데이터베이스 자동 설정 스크립트가 실행되지 않습니다.

## 🏃‍♂️ 실행

### 개발 모드

```bash
pnpm start:dev
```

### 프로덕션 빌드

```bash
pnpm build
pnpm start:prod
```

## 🧪 테스트

```bash
pnpm test
pnpm test:e2e
```

## 📝 스크립트

- `pnpm start:dev` - 개발 모드로 실행
- `pnpm build` - 프로덕션 빌드
- `pnpm test` - 단위 테스트 실행
- `pnpm lint` - 코드 린팅
- `pnpm format` - 코드 포맷팅
- `pnpm db:setup` - 데이터베이스 자동 설정 (운영체제 자동 감지)
- `pnpm db:reset` - 데이터베이스 리셋 (기존 데이터 삭제 후 재생성)

## ⚠️ 중요 사항

- **반드시 Node.js 22.19.0 버전을 사용하세요**
- **pnpm만 사용하세요** (package.json의 preinstall 스크립트가 이를 강제합니다)
- **MySQL이 설치되어 있고 서비스가 실행 중이어야 합니다**
- npm이나 yarn을 사용하면 설치가 실패할 수 있습니다

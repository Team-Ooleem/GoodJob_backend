# Good Job Nest

NestJS 기반의 백엔드 프로젝트입니다.

## 🚀 시작하기

### 필수 요구사항

- **Node.js**: `22.19.0` (정확한 버전 필수)
- **패키지 매니저**: `pnpm` (npm, yarn 사용 금지)

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

## ⚠️ 중요 사항

- **반드시 Node.js 22.19.0 버전을 사용하세요**
- **pnpm만 사용하세요** (package.json의 preinstall 스크립트가 이를 강제합니다)
- npm이나 yarn을 사용하면 설치가 실패할 수 있습니다

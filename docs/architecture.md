# NestJS 모듈 구조 원칙

NestJS에서는 보통 두 가지 방식으로 프로젝트를 구조화합니다:

1. **계층형(layered) 구조**: `controllers/`, `services/`, `repositories/`로 구분
2. **도메인(기능)별(feature-based) 구조**: `users/`, `companies/`, `auth/` 같은 기능 단위로 모듈화

본 프로젝트는 **기능별 구조**를 채택합니다.

---

## 📂 폴더 구조 예시

src/  
├── common/ # 공통 유틸, 파이프, 데코레이터, 예외 필터 등  
│ ├── decorators/  
│ ├── filters/  
│ ├── interceptors/  
│ ├── pipes/  
│ └── utils/  
│  
├── database/ # DB 관련 (엔티티, 마이그레이션, 시드 데이터 등)  
│ ├── entities/  
│ ├── migrations/  
│ └── seeds/  
│  
├── auth/ # 인증/인가  
│ ├── auth.controller.ts  
│ ├── auth.service.ts  
│ └── auth.module.ts  
│  
├── users/ # 사용자 (users 테이블)  
│ ├── dto/  
│ ├── entities/  
│ ├── users.controller.ts  
│ ├── users.service.ts  
│ └── users.module.ts  
│  
├── business-profile/ # 기업 회원 정보 (business_profile)  
│ ├── dto/  
│ ├── entities/  
│ ├── business-profile.controller.ts  
│ ├── business-profile.service.ts  
│ └── business-profile.module.ts  
│  
├── companies/ # 기업 정보 (companies, company_type, etc.)  
│ ├── dto/  
│ ├── entities/  
│ ├── companies.controller.ts  
│ ├── companies.service.ts  
│ └── companies.module.ts  
│  
├── career/ # 경력 관리 (career, career_type)  
│ ├── dto/  
│ ├── entities/  
│ ├── career.controller.ts  
│ ├── career.service.ts  
│ └── career.module.ts  
│  
├── education/ # 학력 관리 (educate, education_level)  
│ ├── dto/  
│ ├── entities/  
│ ├── education.controller.ts  
│ ├── education.service.ts  
│ └── education.module.ts  
│  
│ ├── admin.service.ts  
│ └── admin.module.ts  
│  
├── app.module.ts # 루트 모듈
└── main.ts # 진입점

---

## 📌 DTO와 Entities 사용 원칙

### 1. `entities/` 폴더

- **언제 필요한가?**
    - DB 테이블과 직접 연결되는 경우
    - ORM(Entity) 정의가 필요한 경우
- **예시**
    - `users`, `companies`, `career`, `education`

### 2. `dto/` 폴더

- **언제 필요한가?**
    - 외부 요청(Request Body, Query, Param) 검증이 필요한 경우
    - API 입출력 데이터 형식 정의
- **예시**
    - `users` → 회원가입, 로그인 요청
    - `career` → 경력 추가, 수정 요청

### 3. 둘 다 필요 없는 경우

- 단순 코드 테이블 관리 (예: `company_type`, `education_level`)
- 단순 조회 기능만 있는 경우
- → `*.entity.ts`만 두거나, 모듈 루트에 간단히 정의 가능

---

## 📊 모듈별 DTO/Entities 필요 여부

| 모듈               | Entities | DTO | 비고                         |
| ------------------ | -------- | --- | ---------------------------- |
| `users`            | ✅       | ✅  | 사용자 계정 관리             |
| `business-profile` | ✅       | ✅  | 기업 회원 전용 정보          |
| `companies`        | ✅       | ✅  | 기업 리스트, 상세            |
| `career`           | ✅       | ✅  | 경력 관리                    |
| `education`        | ✅       | ✅  | 학력 관리                    |
| `company_type`     | ✅       | ❌  | 코드 관리 (간단)             |
| `education_level`  | ✅       | ❌  | 코드 관리 (간단)             |
| `auth`             | ❌       | ✅  | 인증/인가 (엔티티 필요 없음) |
| `admin`            | ❌       | ✅  | 관리 기능 중심               |

---

## 🔑 정리

- **DB 테이블과 연결된다 → `entities/` 필요**
- **API 요청/응답 검증이 필요하다 → `dto/` 필요**
- **단순 코드 관리나 내부 전용 기능 → 생략 가능**

이 원칙을 기준으로 기능별 모듈을 정리하면 유지보수성과 확장성이 좋아집니다.

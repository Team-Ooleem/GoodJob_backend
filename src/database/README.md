# Database Module

MySQL 8.0과 연결하는 데이터베이스 모듈입니다.

## 설정

### 1. 환경 변수 설정

프로젝트 루트에 `.env` 파일을 생성하고 다음 내용을 추가하세요:

```env
# Database Configuration
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=your_password_here
DB_NAME=good_job_db

# Application Configuration
NODE_ENV=development
PORT=3000
```

### 2. MySQL 데이터베이스 생성

MySQL에서 다음 명령을 실행하여 데이터베이스를 생성하세요:

```sql
CREATE DATABASE good_job_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

## 사용법

### DatabaseService 사용 예시

```typescript
import { DatabaseService } from './database/database.service';

@Injectable()
export class UserService {
    constructor(private databaseService: DatabaseService) {}

    async findAll(): Promise<User[]> {
        const users = await this.databaseService.query<User>(
            'SELECT * FROM users WHERE active = ?',
            [true],
        );
        return users;
    }

    async createUser(userData: CreateUserDto): Promise<User> {
        return await this.databaseService.transaction(async (connection) => {
            const [result] = await connection.execute(
                'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
                [userData.name, userData.email, userData.password],
            );

            const userId = (result as any).insertId;
            const [user] = await connection.execute('SELECT * FROM users WHERE id = ?', [userId]);

            return user[0];
        });
    }
}
```

## API 엔드포인트

- `GET /database/health` - 데이터베이스 연결 상태 확인
- `GET /database/test-query` - 간단한 테스트 쿼리 실행

## 주요 기능

- **자동 연결 관리**: 애플리케이션 시작 시 자동으로 데이터베이스에 연결
- **커넥션 풀**: 효율적인 데이터베이스 연결 관리
- **트랜잭션 지원**: 안전한 데이터베이스 트랜잭션 처리
- **헬스 체크**: 데이터베이스 연결 상태 모니터링
- **에러 처리**: 연결 실패 및 쿼리 오류에 대한 적절한 에러 처리

## 주의사항

- MySQL 8.0 이상 버전이 필요합니다
- `mysql2` 패키지를 사용하여 Promise 기반의 비동기 처리
- 환경 변수 파일(`.env`)은 `.gitignore`에 포함되어 있어야 합니다
- 프로덕션 환경에서는 적절한 보안 설정을 적용하세요

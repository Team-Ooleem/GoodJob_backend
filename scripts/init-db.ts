import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

interface DatabaseConfig {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
}

// .env 파일 읽기
function loadEnvFile(): Record<string, string> {
    const envPath = path.join(__dirname, '..', '.env');

    if (!fs.existsSync(envPath)) {
        console.error('❌ .env 파일을 찾을 수 없습니다.');
        console.error('env.example 파일을 복사하여 .env 파일을 생성하고 설정을 입력해주세요.');
        process.exit(1);
    }

    const envContent = fs.readFileSync(envPath, 'utf8');
    const env: Record<string, string> = {};

    envContent.split('\n').forEach((line) => {
        const trimmedLine = line.trim();
        if (trimmedLine && !trimmedLine.startsWith('#')) {
            const [key, ...valueParts] = trimmedLine.split('=');
            if (key && valueParts.length > 0) {
                env[key.trim()] = valueParts.join('=').trim();
            }
        }
    });

    return env;
}

// SQL 파일에서 테이블 개수 계산
function countTablesInSQLFile(sqlFilePath: string): number {
    try {
        const sqlContent = fs.readFileSync(sqlFilePath, 'utf8');
        const createTableMatches = sqlContent.match(/CREATE TABLE\s+`[^`]+`/gi);
        return createTableMatches ? createTableMatches.length : 0;
    } catch (error) {
        console.error('SQL 파일 읽기 실패:', error);
        return 0;
    }
}

class DatabaseInitializer {
    private config: DatabaseConfig;

    constructor(config: DatabaseConfig) {
        this.config = config;
    }

    async checkMySQLConnection(): Promise<boolean> {
        try {
            const command = `mysql -h ${this.config.host} -P ${this.config.port} -u ${this.config.user} -p${this.config.password} -e "SELECT 1;"`;
            await execAsync(command);
            console.log('✅ MySQL 연결 성공');
            return true;
        } catch (error) {
            console.error('❌ MySQL 연결 실패:', error);
            return false;
        }
    }

    async dropDatabase(): Promise<boolean> {
        try {
            const command = `mysql -h ${this.config.host} -P ${this.config.port} -u ${this.config.user} -p${this.config.password} -e "DROP DATABASE IF EXISTS \`${this.config.database}\`;"`;
            await execAsync(command);
            console.log(`✅ 데이터베이스 '${this.config.database}' 삭제 완료`);
            return true;
        } catch (error) {
            console.error('❌ 데이터베이스 삭제 실패:', error);
            return false;
        }
    }

    async createDatabase(): Promise<boolean> {
        try {
            const command = `mysql -h ${this.config.host} -P ${this.config.port} -u ${this.config.user} -p${this.config.password} -e "CREATE DATABASE IF NOT EXISTS \`${this.config.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"`;
            await execAsync(command);
            console.log(`✅ 데이터베이스 '${this.config.database}' 생성 완료`);
            return true;
        } catch (error) {
            console.error('❌ 데이터베이스 생성 실패:', error);
            return false;
        }
    }

    async importSchema(): Promise<boolean> {
        try {
            const sqlFilePath = path.join(__dirname, '..', 'sql', 'good_job.sql');

            if (!fs.existsSync(sqlFilePath)) {
                console.error(`❌ SQL 파일을 찾을 수 없습니다: ${sqlFilePath}`);
                return false;
            }

            // SQL 파일에서 테이블 개수 계산
            const totalTables = countTablesInSQLFile(sqlFilePath);
            console.log(`📊 총 ${totalTables}개의 테이블을 생성합니다...`);

            // SQL 파일 내용을 읽어서 데이터베이스 이름을 동적으로 변경
            let sqlContent = fs.readFileSync(sqlFilePath, 'utf8');

            // 하드코딩된 데이터베이스 이름을 동적으로 변경
            sqlContent = sqlContent.replace(/USE\s+`[^`]+`;/g, `USE \`${this.config.database}\`;`);

            // CREATE DATABASE 부분도 동적으로 변경
            sqlContent = sqlContent.replace(
                /CREATE DATABASE IF NOT EXISTS\s+`[^`]+`/g,
                `CREATE DATABASE IF NOT EXISTS \`${this.config.database}\``,
            );

            // CREATE TABLE 쿼리들을 개별적으로 실행하여 상세한 로깅 제공
            const createTableQueries = this.extractCreateTableQueries(sqlContent);
            console.log(`🔍 ${createTableQueries.length}개의 CREATE TABLE 쿼리를 찾았습니다.`);

            let successCount = 0;
            for (let i = 0; i < createTableQueries.length; i++) {
                const query = createTableQueries[i];
                const tableName = this.extractTableName(query);

                console.log(
                    `📋 테이블 생성 시도 (${i + 1}/${createTableQueries.length}): ${tableName}`,
                );

                try {
                    const command = `mysql -h ${this.config.host} -P ${this.config.port} -u ${this.config.user} -p${this.config.password} ${this.config.database} -e "${query.replace(/"/g, '\\"')}"`;
                    await execAsync(command);
                    console.log(`✅ 테이블 생성 성공: ${tableName}`);
                    successCount++;
                } catch (error) {
                    console.error(`❌ 테이블 생성 실패: ${tableName}`);
                    console.error(`   오류: ${error}`);
                }
            }

            console.log(`📊 테이블 생성 결과: ${successCount}/${createTableQueries.length} 성공`);

            // 나머지 쿼리들 (INSERT, ALTER 등) 실행
            const remainingQueries = this.extractRemainingQueries(sqlContent);
            if (remainingQueries.length > 0) {
                console.log(`🔄 나머지 ${remainingQueries.length}개 쿼리 실행 중...`);

                // 임시 SQL 파일 생성 (CREATE TABLE 제외)
                const tempSqlPath = path.join(__dirname, '..', 'sql', 'temp_remaining.sql');
                fs.writeFileSync(tempSqlPath, remainingQueries.join(';\n') + ';');

                try {
                    const command = `mysql -h ${this.config.host} -P ${this.config.port} -u ${this.config.user} -p${this.config.password} ${this.config.database} < "${tempSqlPath}"`;
                    await execAsync(command);
                    console.log(`✅ 나머지 쿼리 실행 완료`);
                } finally {
                    if (fs.existsSync(tempSqlPath)) {
                        fs.unlinkSync(tempSqlPath);
                    }
                }
            }

            return successCount === createTableQueries.length;
        } catch (error) {
            console.error('❌ 스키마 import 실패:', error);
            return false;
        }
    }

    private extractCreateTableQueries(sqlContent: string): string[] {
        const queries: string[] = [];
        const lines = sqlContent.split('\n');
        let currentQuery = '';
        let inCreateTable = false;

        for (const line of lines) {
            const trimmedLine = line.trim();

            if (trimmedLine.toLowerCase().startsWith('create table')) {
                inCreateTable = true;
                currentQuery = trimmedLine;
            } else if (inCreateTable) {
                currentQuery += ' ' + trimmedLine;

                if (trimmedLine.endsWith(';')) {
                    queries.push(currentQuery);
                    currentQuery = '';
                    inCreateTable = false;
                }
            }
        }

        return queries;
    }

    private extractRemainingQueries(sqlContent: string): string[] {
        const queries: string[] = [];
        const lines = sqlContent.split('\n');
        let currentQuery = '';
        let inQuery = false;

        for (const line of lines) {
            const trimmedLine = line.trim();

            if (
                trimmedLine &&
                !trimmedLine.toLowerCase().startsWith('create table') &&
                !trimmedLine.toLowerCase().startsWith('use') &&
                !trimmedLine.toLowerCase().startsWith('create database')
            ) {
                if (!inQuery) {
                    inQuery = true;
                    currentQuery = trimmedLine;
                } else {
                    currentQuery += ' ' + trimmedLine;
                }

                if (trimmedLine.endsWith(';')) {
                    queries.push(currentQuery);
                    currentQuery = '';
                    inQuery = false;
                }
            }
        }

        return queries;
    }

    private extractTableName(query: string): string {
        const match = query.match(/CREATE TABLE\s+`([^`]+)`/i);
        return match ? match[1] : 'unknown_table';
    }

    async initialize(): Promise<void> {
        console.log('🚀 데이터베이스 초기화 시작...\n');

        // 1. MySQL 연결 확인
        const isConnected = await this.checkMySQLConnection();
        if (!isConnected) {
            console.error('MySQL 연결에 실패했습니다. MySQL이 실행 중인지 확인해주세요.');
            process.exit(1);
        }

        // 2. 데이터베이스 생성
        const isDatabaseCreated = await this.createDatabase();
        if (!isDatabaseCreated) {
            console.error('데이터베이스 생성에 실패했습니다.');
            process.exit(1);
        }

        // 3. 스키마 import
        const isSchemaImported = await this.importSchema();
        if (!isSchemaImported) {
            console.error('스키마 import에 실패했습니다.');
            process.exit(1);
        }

        console.log('\n🎉 데이터베이스 초기화 완료!');
        console.log(`📊 데이터베이스: ${this.config.database}`);
        console.log(`🌐 호스트: ${this.config.host}:${this.config.port}`);
    }

    async reset(): Promise<void> {
        console.log('🔄 데이터베이스 리셋 시작...\n');

        // 1. MySQL 연결 확인
        const isConnected = await this.checkMySQLConnection();
        if (!isConnected) {
            console.error('MySQL 연결에 실패했습니다. MySQL이 실행 중인지 확인해주세요.');
            process.exit(1);
        }

        // 2. 기존 데이터베이스 삭제
        const isDatabaseDropped = await this.dropDatabase();
        if (!isDatabaseDropped) {
            console.error('데이터베이스 삭제에 실패했습니다.');
            process.exit(1);
        }

        // 3. 데이터베이스 재생성
        const isDatabaseCreated = await this.createDatabase();
        if (!isDatabaseCreated) {
            console.error('데이터베이스 생성에 실패했습니다.');
            process.exit(1);
        }

        // 4. 스키마 import
        const isSchemaImported = await this.importSchema();
        if (!isSchemaImported) {
            console.error('스키마 import에 실패했습니다.');
            process.exit(1);
        }

        console.log('\n🎉 데이터베이스 리셋 완료!');
        console.log(`📊 데이터베이스: ${this.config.database}`);
        console.log(`🌐 호스트: ${this.config.host}:${this.config.port}`);
    }
}

// .env 파일에서 설정 로드
function loadConfig(): DatabaseConfig {
    console.log('📝 .env 파일에서 설정을 로드하는 중...');
    const env = loadEnvFile();

    const config: DatabaseConfig = {
        host: env.DB_HOST || 'localhost',
        port: parseInt(env.DB_PORT || '3306', 10),
        user: env.DB_USERNAME || 'root',
        password: env.DB_PASSWORD || '',
        database: env.DB_DATABASE || 'good_job_test',
    };

    // 필수 설정 확인
    if (!config.user) {
        console.error('❌ DB_USERNAME이 설정되지 않았습니다.');
        process.exit(1);
    }

    return config;
}

// 스크립트 실행
if (require.main === module) {
    const config = loadConfig();
    const initializer = new DatabaseInitializer(config);

    // 명령행 인수 확인
    const args = process.argv.slice(2);
    const isReset = args.includes('--reset');

    if (isReset) {
        initializer.reset().catch(console.error);
    } else {
        initializer.initialize().catch(console.error);
    }
}

export type { DatabaseConfig };
export { DatabaseInitializer };

const mysql = require('mysql2/promise');
const os = require('os');
const path = require('path');
const fs = require('fs');

// 터미널 색상 코드
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
};

function log(message, color = 'white') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
    log(`✅ ${message}`, 'green');
}

function logError(message) {
    log(`❌ ${message}`, 'red');
}

function logInfo(message) {
    log(`ℹ️  ${message}`, 'blue');
}

function logWarning(message) {
    log(`⚠️  ${message}`, 'yellow');
}

// .env 파일 읽기
function loadEnvFile() {
    const envPath = path.join(__dirname, '..', '.env');

    if (!fs.existsSync(envPath)) {
        logError('.env 파일을 찾을 수 없습니다.');
        log('env.example 파일을 복사하여 .env 파일을 생성하고 설정을 입력해주세요.', 'red');
        process.exit(1);
    }

    const envContent = fs.readFileSync(envPath, 'utf8');
    const env = {};

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
function countTablesInSQLFile(sqlFilePath) {
    try {
        const sqlContent = fs.readFileSync(sqlFilePath, 'utf8');
        const createTableMatches = sqlContent.match(/CREATE TABLE\s+`[^`]+`/gi);
        return createTableMatches ? createTableMatches.length : 0;
    } catch (error) {
        logError(`SQL 파일 읽기 실패: ${error.message}`);
        return 0;
    }
}

// SQL 파일을 쿼리로 분할
function splitSQLFile(sqlFilePath) {
    try {
        const sqlContent = fs.readFileSync(sqlFilePath, 'utf8');

        // 주석 제거 및 쿼리 분할
        const queries = sqlContent
            .replace(/--.*$/gm, '') // 한 줄 주석 제거
            .replace(/\/\*[\s\S]*?\*\//g, '') // 블록 주석 제거
            .split(';')
            .map((query) => query.trim())
            .filter(
                (query) => query.length > 0 && !query.toLowerCase().startsWith('create database'),
            );

        return queries;
    } catch (error) {
        logError(`SQL 파일 파싱 실패: ${error.message}`);
        return [];
    }
}

// 운영체제 감지
function detectOS() {
    const platform = os.platform();
    switch (platform) {
        case 'win32':
            return 'windows';
        case 'darwin':
            return 'mac';
        case 'linux':
            return 'linux';
        default:
            return 'unknown';
    }
}

class DatabaseSetup {
    constructor(config) {
        this.config = config;
        this.connection = null;
    }

    async connect() {
        try {
            // 데이터베이스 없이 연결 (데이터베이스 생성용)
            this.connection = await mysql.createConnection({
                host: this.config.host,
                port: this.config.port,
                user: this.config.user,
                password: this.config.password,
            });

            logSuccess('MySQL 서버 연결 성공');
            return true;
        } catch (error) {
            logError(`MySQL 서버 연결 실패: ${error.message}`);
            return false;
        }
    }

    async createDatabase() {
        try {
            await this.connection.execute(
                `CREATE DATABASE IF NOT EXISTS \`${this.config.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
            );
            logSuccess(`데이터베이스 '${this.config.database}' 생성 완료`);
            return true;
        } catch (error) {
            logError(`데이터베이스 생성 실패: ${error.message}`);
            return false;
        }
    }

    async dropDatabase() {
        try {
            await this.connection.execute(`DROP DATABASE IF EXISTS \`${this.config.database}\``);
            logSuccess(`데이터베이스 '${this.config.database}' 삭제 완료`);
            return true;
        } catch (error) {
            logError(`데이터베이스 삭제 실패: ${error.message}`);
            return false;
        }
    }

    async useDatabase() {
        try {
            await this.connection.query(`USE \`${this.config.database}\``);
            logSuccess(`데이터베이스 '${this.config.database}' 선택 완료`);
            return true;
        } catch (error) {
            logError(`데이터베이스 선택 실패: ${error.message}`);
            return false;
        }
    }

    async executeQueries(queries) {
        let successCount = 0;
        let totalQueries = queries.length;
        let tableCount = 0;

        logInfo(`${totalQueries}개의 쿼리를 실행합니다...`);

        for (let i = 0; i < queries.length; i++) {
            const query = queries[i];
            if (query.trim()) {
                // CREATE TABLE 쿼리인지 확인
                const isCreateTable = query.trim().toLowerCase().startsWith('create table');
                let tableName = '';

                if (isCreateTable) {
                    tableCount++;
                    // 테이블 이름 추출
                    const tableMatch = query.match(/CREATE TABLE\s+`([^`]+)`/i);
                    if (tableMatch) {
                        tableName = tableMatch[1];
                        log(`�� 테이블 생성 시도 (${tableCount}번째): ${tableName}`, 'cyan');
                    }
                }

                try {
                    // USE 명령어는 query() 메서드 사용, 나머지는 execute() 사용
                    if (query.trim().toLowerCase().startsWith('use')) {
                        await this.connection.query(query);
                    } else {
                        await this.connection.execute(query);
                    }
                    successCount++;

                    if (isCreateTable && tableName) {
                        logSuccess(`✅ 테이블 생성 성공: ${tableName}`);
                    }

                    // 진행률 표시 (CREATE TABLE이 아닌 쿼리들)
                    if (!isCreateTable && (i % 10 === 0 || i === queries.length - 1)) {
                        const progress = Math.round(((i + 1) / totalQueries) * 100);
                        log(`진행률: ${progress}% (${i + 1}/${totalQueries})`, 'cyan');
                    }
                } catch (error) {
                    if (isCreateTable && tableName) {
                        logError(`❌ 테이블 생성 실패: ${tableName}`);
                        logError(`   오류: ${error.message}`);
                    } else {
                        logWarning(`쿼리 실행 실패 (${i + 1}번째): ${error.message}`);
                        logWarning(`실패한 쿼리: ${query.substring(0, 100)}...`);
                    }
                }
            }
        }

        logSuccess(`${successCount}/${totalQueries} 쿼리 실행 완료`);
        logInfo(`총 ${tableCount}개의 테이블 생성 시도`);
        return successCount === totalQueries;
    }

    async importSchema() {
        const sqlFilePath = path.join(__dirname, '..', 'sql', 'schema.sql');

        if (!fs.existsSync(sqlFilePath)) {
            logError(`SQL 파일을 찾을 수 없습니다: ${sqlFilePath}`);
            return false;
        }

        const totalTables = countTablesInSQLFile(sqlFilePath);
        logInfo(`총 ${totalTables}개의 테이블을 생성합니다...`);

        const queries = splitSQLFile(sqlFilePath);
        if (queries.length === 0) {
            logError('SQL 파일에서 유효한 쿼리를 찾을 수 없습니다.');
            return false;
        }

        return await this.executeQueries(queries);
    }

    async importData() {
        const dataFiles = [
            { name: 'interview.sql', path: path.join(__dirname, '..', 'sql', 'interview.sql') },
            { name: 'job-role.sql', path: path.join(__dirname, '..', 'sql', 'job-role.sql') },
            { name: 'dummy.sql', path: path.join(__dirname, '..', 'sql', 'dummy.sql') },
        ];

        let allSuccess = true;

        for (const file of dataFiles) {
            if (!fs.existsSync(file.path)) {
                logError(`${file.name} 파일을 찾을 수 없습니다: ${file.path}`);
                allSuccess = false;
                continue;
            }

            logInfo(`${file.name} import를 시작합니다...`);

            const queries = splitSQLFile(file.path);
            if (queries.length === 0) {
                logError(`${file.name} 파일에서 유효한 쿼리를 찾을 수 없습니다.`);
                allSuccess = false;
                continue;
            }

            const success = await this.executeQueries(queries);
            if (!success) {
                logWarning(`${file.name} import에 실패했습니다.`);
                allSuccess = false;
            } else {
                logSuccess(`${file.name} import 완료`);
            }
        }

        return allSuccess;
    }

    async close() {
        if (this.connection) {
            await this.connection.end();
            logInfo('데이터베이스 연결 종료');
        }
    }

    async initialize(withData = false) {
        const initType = withData ? '스키마 + 데이터' : '스키마만';
        log(`🚀 mysql2를 사용한 데이터베이스 초기화 시작 (${initType})...`, 'bright');
        console.log('');

        // 1. MySQL 서버 연결
        const isConnected = await this.connect();
        if (!isConnected) {
            logError('MySQL 서버에 연결할 수 없습니다. MySQL이 실행 중인지 확인해주세요.');
            process.exit(1);
        }

        // 2. 데이터베이스 생성
        const isDatabaseCreated = await this.createDatabase();
        if (!isDatabaseCreated) {
            await this.close();
            process.exit(1);
        }

        // 3. 데이터베이스 선택
        const isDatabaseSelected = await this.useDatabase();
        if (!isDatabaseSelected) {
            await this.close();
            process.exit(1);
        }

        // 4. 스키마 import
        const isSchemaImported = await this.importSchema();
        if (!isSchemaImported) {
            logWarning('일부 스키마 import에 실패했습니다.');
        }

        // 5. 데이터 import (옵션)
        if (withData) {
            console.log('');
            logInfo('데이터 import 시작...');
            const isDataImported = await this.importData();
            if (!isDataImported) {
                logWarning('일부 데이터 import에 실패했습니다.');
            }
        }

        await this.close();

        console.log('');
        logSuccess('데이터베이스 초기화 완료!');
        log(`📊 데이터베이스: ${this.config.database}`, 'white');
        log(`🌐 호스트: ${this.config.host}:${this.config.port}`, 'white');
        if (withData) {
            logSuccess('✅ 스키마와 기본 데이터가 모두 로드되었습니다.');
        } else {
            logSuccess('✅ 스키마가 로드되었습니다.');
        }
    }

    async reset(withData = false) {
        const resetType = withData ? '스키마 + 데이터' : '스키마만';
        log(`🔄 mysql2를 사용한 데이터베이스 리셋 시작 (${resetType})...`, 'bright');
        console.log('');

        // 1. MySQL 서버 연결
        const isConnected = await this.connect();
        if (!isConnected) {
            logError('MySQL 서버에 연결할 수 없습니다. MySQL이 실행 중인지 확인해주세요.');
            process.exit(1);
        }

        // 2. 기존 데이터베이스 삭제
        const isDatabaseDropped = await this.dropDatabase();
        if (!isDatabaseDropped) {
            await this.close();
            process.exit(1);
        }

        // 3. 데이터베이스 재생성
        const isDatabaseCreated = await this.createDatabase();
        if (!isDatabaseCreated) {
            await this.close();
            process.exit(1);
        }

        // 4. 데이터베이스 선택
        const isDatabaseSelected = await this.useDatabase();
        if (!isDatabaseSelected) {
            await this.close();
            process.exit(1);
        }

        // 5. 스키마 import
        const isSchemaImported = await this.importSchema();
        if (!isSchemaImported) {
            logWarning('일부 스키마 import에 실패했습니다.');
        }

        // 6. 데이터 import (옵션)
        if (withData) {
            console.log('');
            logInfo('데이터 import 시작...');
            const isDataImported = await this.importData();
            if (!isDataImported) {
                logWarning('일부 데이터 import에 실패했습니다.');
            }
        }

        await this.close();

        console.log('');
        logSuccess('데이터베이스 리셋 완료!');
        log(`📊 데이터베이스: ${this.config.database}`, 'white');
        log(`🌐 호스트: ${this.config.host}:${this.config.port}`, 'white');
        if (withData) {
            logSuccess('✅ 스키마와 기본 데이터가 모두 재로드되었습니다.');
        } else {
            logSuccess('✅ 스키마가 재로드되었습니다.');
        }
    }
}

// 메인 함수
async function main() {
    try {
        log('🚀 Good Job 데이터베이스 설정 시작...', 'bright');
        console.log('');

        const osType = detectOS();
        logInfo(`감지된 운영체제: ${osType}`);

        // .env 파일에서 설정 로드
        logInfo('.env 파일에서 설정을 로드하는 중...');
        const env = loadEnvFile();

        const config = {
            host: env.DB_HOST || 'localhost',
            port: parseInt(env.DB_PORT || '3306', 10),
            user: env.DB_USERNAME || 'root',
            password: env.DB_PASSWORD || '',
            database: env.DB_DATABASE || 'good_job_test',
        };

        // 필수 설정 확인
        if (!config.user) {
            logError('DB_USERNAME이 설정되지 않았습니다.');
            process.exit(1);
        }

        const dbSetup = new DatabaseSetup(config);

        // 명령행 인수 확인
        const args = process.argv.slice(2);
        const isReset = args.includes('--reset');
        const withData = args.includes('--with-data');

        if (isReset) {
            await dbSetup.reset(withData);
        } else {
            await dbSetup.initialize(withData);
        }
    } catch (error) {
        logError(`오류가 발생했습니다: ${error.message}`);
        process.exit(1);
    }
}

// 스크립트 실행
if (require.main === module) {
    main().catch((error) => {
        logError(`오류가 발생했습니다: ${error.message}`);
        process.exit(1);
    });
}

module.exports = { main, detectOS, DatabaseSetup };

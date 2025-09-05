import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as mysql from 'mysql2/promise';

interface DatabaseConfig {
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
    charset: string;
    timezone: string;
}

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
    private connection: mysql.Connection | null = null;
    private pool: mysql.Pool | null = null;

    constructor(private configService: ConfigService) {}

    async onModuleInit() {
        await this.connect();
    }

    async onModuleDestroy() {
        await this.disconnect();
    }

    async connect(): Promise<void> {
        try {
            const dbConfig = this.configService.get<DatabaseConfig>('database');
            if (!dbConfig) {
                throw new Error('데이터베이스 설정을 찾을 수 없습니다.');
            }

            // 단일 연결 생성
            this.connection = await mysql.createConnection({
                host: dbConfig.host,
                port: dbConfig.port,
                user: dbConfig.username,
                password: dbConfig.password,
                database: dbConfig.database,
                charset: dbConfig.charset,
                timezone: dbConfig.timezone,
            });

            // 커넥션 풀 생성
            this.pool = mysql.createPool({
                host: dbConfig.host,
                port: dbConfig.port,
                user: dbConfig.username,
                password: dbConfig.password,
                database: dbConfig.database,
                charset: dbConfig.charset,
                timezone: dbConfig.timezone,
                waitForConnections: true,
                connectionLimit: 10,
                queueLimit: 0,
            });

            console.log('✅ MySQL 데이터베이스에 성공적으로 연결되었습니다.');
        } catch (error) {
            console.error('❌ MySQL 데이터베이스 연결 실패:', error);
            throw error;
        }
    }

    async disconnect(): Promise<void> {
        try {
            if (this.connection) {
                await this.connection.end();
                this.connection = null;
            }

            if (this.pool) {
                await this.pool.end();
                this.pool = null;
            }

            console.log('✅ MySQL 데이터베이스 연결이 종료되었습니다.');
        } catch (error) {
            console.error('❌ MySQL 데이터베이스 연결 종료 실패:', error);
        }
    }

    getConnection(): mysql.Connection | null {
        return this.connection;
    }

    getPool(): mysql.Pool | null {
        return this.pool;
    }

    async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
        if (!this.pool) {
            throw new Error('데이터베이스 풀이 초기화되지 않았습니다.');
        }

        try {
            const [rows] = await this.pool.execute(sql, params);
            return rows as T[];
        } catch (error) {
            console.error('쿼리 실행 오류:', error);
            throw error;
        }
    }

    async queryWithSort<T = any>(
        sql: string,
        params?: any[],
        sortBy?: string,
        sortOrder: 'ASC' | 'DESC' = 'ASC',
    ): Promise<T[]> {
        if (!this.pool) {
            throw new Error('데이터베이스 풀이 초기화되지 않았습니다.');
        }

        try {
            let finalSql = sql;
            if (sortBy) {
                finalSql += ` ORDER BY ${sortBy} ${sortOrder}`;
            }

            const [rows] = await this.pool.execute(finalSql, params);
            return rows as T[];
        } catch (error) {
            console.error('쿼리 실행 오류:', error);
            throw error;
        }
    }

    async transaction<T>(callback: (connection: mysql.Connection) => Promise<T>): Promise<T> {
        if (!this.pool) {
            throw new Error('데이터베이스 풀이 초기화되지 않았습니다.');
        }

        const connection = await this.pool.getConnection();

        try {
            await connection.beginTransaction();
            const result = await callback(connection);
            await connection.commit();
            return result;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    // interview 쪽에서 추가
    async execute(sql: string, params: any[] = []) {
        if (!this.pool) {
            throw new Error('데이터베이스 풀이 초기화되지 않았습니다.');
        }
        const [res] = await this.pool.execute(sql, params);
        return res;
    }

    async healthCheck(): Promise<boolean> {
        try {
            if (!this.connection) {
                return false;
            }

            await this.connection.ping();
            return true;
        } catch {
            return false;
        }
    }
}

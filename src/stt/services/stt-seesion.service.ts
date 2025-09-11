import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { ChunkCacheData, SessionUserResponse } from '../entities/transcription';

@Injectable()
export class STTSessionService {
    private readonly logger = new Logger(STTSessionService.name);
    private chunkCache: Map<string, ChunkCacheData> = new Map();
    private readonly MAX_CACHE_SIZE = 50;
    private readonly BATCH_SIZE = 1000;
    private readonly INACTIVITY_THRESHOLD = 5000; // 5초

    constructor(private readonly databaseService: DatabaseService) {}

    // 세션 사용자 조회
    async getSessionUsers(canvasId: string): Promise<SessionUserResponse> {
        try {
            const result = await this.databaseService.query(
                `SELECT 
                    st.mentor_idx,
                    st.mentee_idx,
                    mentor.name as mentor_name,
                    mentee.name as mentee_name
                 FROM stt_transcriptions st
                 JOIN users mentor ON st.mentor_idx = mentor.idx
                 JOIN users mentee ON st.mentee_idx = mentee.idx
                 WHERE st.canvas_id = ?
                 LIMIT 1`,
                [canvasId],
            );

            if (!result.length) throw new Error('해당 캔버스 세션 없음');

            const session = result[0] as {
                mentor_idx: number;
                mentor_name: string;
                mentee_idx: number;
                mentee_name: string;
            };
            return {
                success: true,
                canvasId: canvasId,
                mentor: { idx: session.mentor_idx, name: session.mentor_name },
                mentee: { idx: session.mentee_idx, name: session.mentee_name },
            };
        } catch (error) {
            this.logger.error(`세션 사용자 조회 실패: ${error}`);
            throw error;
        }
    }

    // 캐시 관리
    getCached(sessionKey: string): ChunkCacheData | undefined {
        return this.chunkCache.get(sessionKey);
    }

    addToCache(sessionKey: string, data: ChunkCacheData) {
        if (this.chunkCache.size >= this.MAX_CACHE_SIZE) {
            const firstKey = this.chunkCache.keys().next().value as string;
            this.chunkCache.delete(firstKey);
        }
        this.chunkCache.set(sessionKey, data);
    }

    deleteFromCache(sessionKey: string) {
        this.chunkCache.delete(sessionKey);
    }

    // 배치 INSERT
    async batchInsertSegments(segments: Array<[number, number, string, number, number]>) {
        for (let i = 0; i < segments.length; i += this.BATCH_SIZE) {
            const batch = segments.slice(i, i + this.BATCH_SIZE);
            const placeholders = batch.map(() => '(?, ?, ?, ?, ?)').join(', ');
            const flatValues = batch.flat();

            await this.databaseService.query(
                `INSERT INTO stt_speaker_segments
                 (stt_session_idx, speaker_idx, text_content, start_time, end_time)
                 VALUES ${placeholders}`,
                flatValues,
            );
        }
    }

    // 비활성 세션 정리
    cleanupInactiveSessions() {
        const now = Date.now();
        let cleanedCount = 0;

        for (const [sessionKey, cached] of this.chunkCache.entries()) {
            if (now - cached.lastActivity > this.INACTIVITY_THRESHOLD) {
                this.chunkCache.delete(sessionKey);
                cleanedCount++;
            }
        }

        return { success: true, cleanedCount };
    }
}

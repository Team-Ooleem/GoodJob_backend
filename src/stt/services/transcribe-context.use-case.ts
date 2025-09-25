// 파일 상단에 추가

import { Injectable, BadRequestException } from '@nestjs/common';
import { TranscribeChunkRequest, STTWithContextResponse } from '../entities/transcription';
// import { SessionTimerService } from './session-timer.service';
import { DatabaseService } from '../../database/database.service';
import { STTUtilService } from './stt-util.service';
import { AudioChunkProcessorService } from './audio-chunk-processor.service';
import { SessionFinalizerService } from './session-finalizer.service';

@Injectable()
export class TranscribeContextUseCase {
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly utilService: STTUtilService,
        private readonly audioChunkProcessor: AudioChunkProcessorService,
        private readonly sessionFinalizer: SessionFinalizerService,
    ) {}

    async execute(body: TranscribeChunkRequest): Promise<STTWithContextResponse> {
        // 1. 유효성 검증
        this.validateRequest(body);

        // 3. 참가자 정보 조회
        const participants = await this.getParticipants(body.canvasId);
        const actualMentorIdx = participants.mentor?.user_id || body.mentorIdx;
        const actualMenteeIdx = participants.mentee?.user_id || body.menteeIdx;

        const startTime = Date.now();

        // 4. 오디오 데이터 처리
        if (body.audioData) {
            const chunkResult = await this.audioChunkProcessor.process(
                body,
                body.audioData,
                body.mimeType || 'audio/wav',
                body.canvasId,
                actualMentorIdx,
                actualMenteeIdx,
                body.usePynoteDiarization ?? true,
                startTime,
            );

            // 최종 청크일 때만 병합
            if (body.isFinalChunk) {
                return await this.sessionFinalizer.finalize(
                    body.canvasId,
                    actualMentorIdx,
                    actualMenteeIdx,
                    startTime,
                );
            }

            return chunkResult;
        }

        // 5. 오디오 데이터 없이 최종 청크만 온 경우
        if (body.isFinalChunk) {
            return await this.sessionFinalizer.finalize(
                body.canvasId,
                actualMentorIdx,
                actualMenteeIdx,
                startTime,
            );
        }

        throw new BadRequestException('오디오 데이터가 필요합니다');
    }

    private validateRequest(body: TranscribeChunkRequest): void {
        if (!body.canvasId) {
            throw new BadRequestException('canvasId가 필요합니다');
        }

        if (body.audioData && !this.utilService.isValidBase64(body.audioData)) {
            throw new BadRequestException('유효하지 않은 Base64');
        }
    }

    private async getParticipants(canvasId: string) {
        try {
            const participants = (await this.databaseService.execute(
                `
                SELECT 
                    cp.user_id,
                    mp.mentor_idx,
                    mp.is_approved
                FROM canvas_participant cp
                LEFT JOIN mentor_profiles mp ON cp.user_id = mp.mentor_idx
                WHERE cp.canvas_id = ?
            `,
                [canvasId],
            )) as Array<{ user_id: number; mentor_idx: number | null; is_approved: number | null }>;

            const mentor = participants.find((p) => p.mentor_idx && p.is_approved === 1) || null;
            const mentee = participants.find((p) => !p.mentor_idx || p.is_approved !== 1) || null;

            return { mentor, mentee };
        } catch (error) {
            throw new BadRequestException(
                `참가자 정보 조회 실패: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }
}

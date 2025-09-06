// stt.controller.ts
import {
    Controller,
    Get,
    Post,
    Body,
    Delete,
    BadRequestException,
    InternalServerErrorException,
    Logger,
    Param,
} from '@nestjs/common';

import { STTService, STTResult } from './stt_service';
import { uploadFileToS3, fileS3Key } from '../lib/s3';
import { DatabaseService } from '../database/database.service';

interface TranscribeBase64Request {
    audioData: string;
    mimeType?: string;
}

interface TranscribeWithContextRequest {
    audioData: string;
    mimeType?: string;
    canvasIdx: number;
    mentorIdx: number;
    menteeIdx: number;
    duration?: number;
}

interface STTResponse {
    success: boolean;
    timestamp: string;
    processingTime: number;
    result: STTResult;
}

interface STTWithContextResponse {
    success: boolean;
    timestamp: string;
    processingTime: number;
    sttSessionIdx: number;
    contextText: string;
    audioUrl: string;
    speakers: Array<{
        speakerTag: number;
        textContent: string;
        startTime: number;
        endTime: number;
    }>;
}

interface ChatMessage {
    messageId: number;
    contextText: string;
    audioUrl: string;
    timestamp: string;
    mentor_idx: number; // 추가
    mentee_idx: number; // 추가
    speakerInfo: {
        mentor: string;
        mentee: string;
    };
    canvasIdx: number;
}

interface ChatMessagesResponse {
    success: boolean;
    messages: ChatMessage[];
    totalCount: number;
}

interface SampleResponse {
    success: boolean;
    message: string;
    result: STTResult;
}

interface ConnectionTestResponse {
    status: 'success' | 'error';
    message: string;
}

interface SessionUserResponse {
    success: boolean;
    canvasIdx: number;
    mentor: {
        idx: number;
        name: string;
    };
    mentee: {
        idx: number;
        name: string;
    };
}

interface TranscribeChunkRequest {
    audioData: string;
    mimeType: string;
    canvasIdx: number;
    chunkIdx: number;
    mentorIdx: number;
    menteeIdx: number;
    duration?: number;
}
interface ChunkResponse {
    success: boolean;
    chunkIndex: number;
    s3Url: string;
    sttSessionIdx: number;
    speakers: Array<{
        speakerTag: number;
        textContent: string;
        startTime: number;
        endTime: number;
    }>;
}

interface MergeChunksRequest {
    canvasIdx: number;
    mentorIdx: number;
    menteeIdx: number;
}

@Controller('stt')
export class STTController {
    private readonly logger = new Logger(STTController.name);

    constructor(
        private readonly sttService: STTService,
        private readonly databaseService: DatabaseService,
    ) {}

    @Get('session-users/:canvasIdx')
    async getSessionUsers(@Param('canvasIdx') canvasIdx: string): Promise<SessionUserResponse> {
        try {
            const result = await this.databaseService.query(
                `
                SELECT 
                    st.mentor_idx,
                    st.mentee_idx,
                    mentor.name as mentor_name,
                    mentee.name as mentee_name
                FROM stt_transcriptions st
                JOIN users mentor ON st.mentor_idx = mentor.idx
                JOIN users mentee ON st.mentee_idx = mentee.idx
                WHERE st.canvas_idx = ?
                LIMIT 1
                `,
                [parseInt(canvasIdx, 10)],
            );

            if (result.length === 0) {
                throw new BadRequestException('해당 캔버스의 세션을 찾을 수 없습니다.');
            }

            const session = result[0] as {
                mentor_idx: number;
                mentee_idx: number;
                mentor_name: string;
                mentee_name: string;
            };

            return {
                success: true,
                canvasIdx: parseInt(canvasIdx, 10),
                mentor: {
                    idx: session.mentor_idx,
                    name: session.mentor_name,
                },
                mentee: {
                    idx: session.mentee_idx,
                    name: session.mentee_name,
                },
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`세션 사용자 조회 실패: ${message}`);
            throw new InternalServerErrorException(`세션 사용자 조회 실패: ${message}`);
        }
    }

    // 화자 분리 + 컨텍스트 추출 + DB 저장
    @Post('transcribe-with-context')
    async transcribeWithContext(
        @Body() body: TranscribeWithContextRequest,
    ): Promise<STTWithContextResponse> {
        const {
            audioData,
            mimeType = 'audio/webm',
            canvasIdx,
            mentorIdx,
            menteeIdx,
            duration,
        } = body;

        if (!audioData) throw new BadRequestException('오디오 데이터가 없습니다.');
        if (!this.isValidBase64(audioData))
            throw new BadRequestException('유효하지 않은 Base64 데이터입니다.');

        this.logger.log(
            `화자 분리 STT 요청: canvasIdx=${canvasIdx}, mentorIdx=${mentorIdx}, menteeIdx=${menteeIdx}, duration=${duration}s`,
        );

        try {
            const startTime = Date.now();

            // 1. STT 변환 (Base64 데이터를 Buffer로 변환)
            const audioBuffer = Buffer.from(audioData, 'base64');
            const sttResult = await this.sttService.transcribeAudioBuffer(audioBuffer, mimeType);

            // 2. duration이 있으면 시간 정규화
            let normalizedSpeakers = sttResult.speakers || [];
            if (duration && duration > 0) {
                normalizedSpeakers = this.sttService.normalizeTimings(normalizedSpeakers, duration);
                this.logger.log(
                    `시간 정규화 적용: STT 최대시간 ${Math.max(...(sttResult.speakers?.map((s) => s.endTime) || [0]))}s → 실제 오디오 ${duration}s`,
                );
            }

            // 3. 오디오 파일 S3 업로드
            const s3Key = fileS3Key('voice_recording', mimeType);
            const s3Result = await uploadFileToS3(audioBuffer, s3Key, mimeType);

            if (!s3Result?.success) throw new Error('오디오 파일 업로드 실패');

            // 4. STT 세션 정보 DB 저장
            const insertSessionResult = await this.databaseService.query(
                'INSERT INTO stt_transcriptions (canvas_idx, mentor_idx, mentee_idx, audio_url, created_at) VALUES (?, ?, ?, ?, NOW())',
                [canvasIdx, mentorIdx, menteeIdx, s3Result.url],
            );

            /* 화자 매핑 */
            const mappedSpeakers = this.mapSpeakersToUsers(
                normalizedSpeakers, // 정규화된 speakers 사용
                mentorIdx,
                menteeIdx,
            );

            const sttSessionIdx = (insertSessionResult as unknown as { insertId: number }).insertId;
            if (typeof sttSessionIdx !== 'number') {
                throw new Error('세션 생성 실패: insertId를 찾을 수 없습니다.');
            }

            // 5. 화자별 세그먼트를 DB에 저장
            for (const segment of mappedSpeakers) {
                await this.databaseService.query(
                    `insert into stt_speaker_segments
                (stt_session_idx, speaker_idx, text_Content, start_time, end_time, created_at)
                values (?, ?, ?, ?, ?, NOW())`,
                    [
                        sttSessionIdx,
                        segment.userId === mentorIdx ? 0 : 1,
                        segment.text_Content,
                        segment.startTime,
                        segment.endTime,
                    ],
                );
            }

            // 6. 컨텍스트 추출 (정규화된 speakers 사용)
            const wordSegments = normalizedSpeakers.map((wordSegment) => ({
                speakerTag: wordSegment.speakerTag || 0,
                textContent: wordSegment.text_Content,
                startTime: wordSegment.startTime,
                endTime: wordSegment.endTime,
            }));

            const contextText = this.extractContextText(
                wordSegments.map((segment) => ({
                    speakerTag: segment.speakerTag,
                    text: segment.textContent,
                    startTime: segment.startTime,
                    endTime: segment.endTime,
                })),
            );

            const processingTime = Date.now() - startTime;

            this.logger.log(
                `화자 분리 STT 완료: 세션 ${sttSessionIdx} 생성, 처리시간 ${processingTime}ms, 컨텍스트: ${contextText}`,
            );

            return {
                success: true,
                timestamp: new Date().toISOString(),
                processingTime,
                sttSessionIdx,
                contextText,
                audioUrl: s3Result.url || '',
                speakers: wordSegments,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`화자 분리 STT 실패: ${message}`);
            throw new InternalServerErrorException(`화자 분리 STT 실패: ${message}`);
        }
    }

    // 세션별 채팅 메시지 목록 조회
    @Get('session-messages/:canvasIdx')
    async getSessionMessages(@Param('canvasIdx') canvasIdx: string): Promise<ChatMessagesResponse> {
        try {
            // 최종 세션만 조회 (audio_url에 'final' 포함)
            const sessions = await this.databaseService.query(
                `SELECT st.*, mentor.name as mentor_name, mentee.name as mentee_name
                 FROM stt_transcriptions st
                 JOIN users mentor ON st.mentor_idx = mentor.idx
                 JOIN users mentee ON st.mentee_idx = mentee.idx
                 WHERE st.canvas_idx = ? AND st.audio_url LIKE '%final%'
                 ORDER BY st.created_at DESC`,
                [canvasIdx],
            );

            const messages: ChatMessage[] = [];
            for (const session of sessions as {
                stt_session_idx: number;
                mentor_idx: number; // 추가
                mentee_idx: number; // 추가
                audio_url: string;
                created_at: string;
                mentor_name: string;
                mentee_name: string;
            }[]) {
                const contextText = await this.getContextTextForSession(session.stt_session_idx);

                messages.push({
                    messageId: session.stt_session_idx,
                    contextText: contextText || '음성 메시지',
                    audioUrl: session.audio_url,
                    timestamp: session.created_at,
                    mentor_idx: session.mentor_idx, // 추가
                    mentee_idx: session.mentee_idx, // 추가
                    speakerInfo: {
                        mentor: session.mentor_name,
                        mentee: session.mentee_name,
                    },
                    canvasIdx: parseInt(canvasIdx, 10),
                });
            }

            return {
                success: true,
                messages,
                totalCount: messages.length,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`세션 메시지 조회 실패: ${message}`);
            throw new InternalServerErrorException(`메시지 조회 실패: ${message}`);
        }
    }

    // 특정 세션의 상세 정보 조회
    @Get('message-detail/:sessionIdx')
    async getMessageDetail(@Param('sessionIdx') sessionIdx: string) {
        try {
            const sessionInfo = await this.databaseService.query(
                `
                SELECT 
                    st.*,
                    mentor.name as mentor_name,
                    mentee.name as mentee_name
                FROM stt_transcriptions st
                JOIN users mentor ON st.mentor_idx = mentor.idx
                JOIN users mentee ON st.mentee_idx = mentee.idx
                WHERE st.stt_session_idx = ?
            `,
                [sessionIdx],
            );

            if (sessionInfo.length === 0) {
                throw new BadRequestException('세션을 찾을 수 없습니다.');
            }

            const segments = await this.databaseService.query(
                `
                SELECT 
                    speaker_idx,
                    text_content,
                    start_time,
                    end_time
                FROM stt_speaker_segments
                WHERE stt_session_idx = ?
                ORDER BY start_time
            `,
                [sessionIdx],
            );

            const contextText = this.extractContextText(
                segments.map(
                    (segment: {
                        speaker_idx: number;
                        text_content: string;
                        start_time: number;
                        end_time: number;
                    }) => ({
                        speakerTag: segment.speaker_idx,
                        text: segment.text_content,
                        startTime: segment.start_time,
                        endTime: segment.end_time,
                    }),
                ),
            );

            return {
                success: true,
                session: sessionInfo[0] as { mentor_name: string; mentee_name: string },
                contextText,
                segments: segments.map(
                    (segment: {
                        speaker_idx: number;
                        text_content: string;
                        start_time: number;
                        end_time: number;
                    }) => ({
                        speakerTag: segment.speaker_idx,
                        text: segment.text_content,
                        startTime: segment.start_time,
                        endTime: segment.end_time,
                    }),
                ),
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`메시지 상세 조회 실패: ${message}`);
            throw new InternalServerErrorException(`메시지 상세 조회 실패: ${message}`);
        }
    }

    // 컨텍스트 텍스트만 조회
    @Get('context/:sessionIdx')
    async getContextText(@Param('sessionIdx') sessionIdx: number): Promise<{
        contextText: string;
        speakers: { speakerTag: number; text: string; startTime: number; endTime: number }[];
    }> {
        try {
            const segments = await this.databaseService.query(
                'SELECT speaker_idx, text_content, start_time, end_time FROM stt_speaker_segments WHERE stt_session_idx = ? ORDER BY start_time',
                [sessionIdx],
            );

            const speakers = segments.map(
                (segment: {
                    speaker_idx: number;
                    text_content: string;
                    start_time: number;
                    end_time: number;
                }) => ({
                    speakerTag: segment.speaker_idx,
                    text: segment.text_content,
                    startTime: segment.start_time,
                    endTime: segment.end_time,
                }),
            );

            const contextText = this.extractContextText(speakers);
            return { contextText, speakers };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`컨텍스트 조회 실패: ${message}`);
            throw new InternalServerErrorException(`컨텍스트 조회 실패: ${message}`);
        }
    }

    // 내부 메서드들
    private async getContextTextForSession(sessionIdx: number): Promise<string> {
        try {
            const segments = await this.databaseService.query(
                `
                SELECT speaker_idx, text_content, start_time, end_time
                FROM stt_speaker_segments
                WHERE stt_session_idx = ?
                ORDER BY start_time
            `,
                [sessionIdx],
            );

            return this.extractContextText(
                segments.map(
                    (segment: {
                        speaker_idx: number;
                        text_content: string;
                        start_time: number;
                        end_time: number;
                    }) => ({
                        speakerTag: segment.speaker_idx,
                        text: segment.text_content,
                        startTime: segment.start_time,
                        endTime: segment.end_time,
                    }),
                ),
            );
        } catch (error) {
            this.logger.error(`컨텍스트 텍스트 조회 실패: ${error}`);
            return '';
        }
    }

    private extractContextText(
        speakers: Array<{ speakerTag: number; text: string; startTime: number; endTime: number }>,
    ): string {
        if (!speakers || speakers.length === 0) {
            return '';
        }

        const sortedSpeakers = speakers.sort((a, b) => a.startTime - b.startTime);
        const contextTexts = sortedSpeakers
            .map((speaker) => speaker.text.trim())
            .filter((text) => {
                if (text.length < 3) return false;
                const meaninglessWords = [
                    '아',
                    '어',
                    '음',
                    '으',
                    '그',
                    '저',
                    '이',
                    '그런데',
                    '그러면',
                    '네',
                    '예',
                    '아니요',
                ];
                if (meaninglessWords.includes(text)) return false;
                if (text.match(/^[.,!?;:]+$/)) return false;
                return true;
            });

        return contextTexts.join(' ');
    }

    // stt.controller.ts에 추가
    @Delete('canvas/:canvasIdx')
    async deleteCanvas(@Param('canvasIdx') canvasIdx: string) {
        try {
            // 1. 해당 캔버스의 모든 STT 세션 조회
            const sessions = await this.databaseService.query(
                'SELECT stt_session_idx FROM stt_transcriptions WHERE canvas_idx = ?',
                [parseInt(canvasIdx, 10)],
            );

            // 2. 각 세션의 화자 세그먼트 삭제
            for (const session of sessions as { stt_session_idx: number }[]) {
                await this.databaseService.query(
                    'DELETE FROM stt_speaker_segments WHERE stt_session_idx = ?',
                    [session.stt_session_idx],
                );
            }

            // 3. STT 세션 삭제
            await this.databaseService.query(
                'DELETE FROM stt_transcriptions WHERE canvas_idx = ?',
                [parseInt(canvasIdx, 10)],
            );

            return { success: true, message: `캔버스 ${canvasIdx} 삭제 완료` };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`캔버스 삭제 실패: ${message}`);
            throw new InternalServerErrorException('캔버스 삭제 실패');
        }
    }

    // 기존 메서드들...
    @Get('test')
    async testConnection(): Promise<ConnectionTestResponse> {
        this.logger.log('STT API 연결 상태 확인 요청');
        const result = await this.sttService.testConnection();
        this.logger.log(`STT API 상태: ${result.status} - ${result.message}`);
        return result;
    }

    @Post('transcribe-base64')
    async transcribeBase64(@Body() body: TranscribeBase64Request): Promise<STTResponse> {
        const { audioData, mimeType = 'audio/webm' } = body;
        if (!audioData) throw new BadRequestException('오디오 데이터가 없습니다.');
        if (!this.isValidBase64(audioData))
            throw new BadRequestException('유효하지 않은 Base64 데이터입니다.');

        this.logger.log(`Base64 음성 데이터 수신: ${mimeType}, 길이: ${audioData.length} bytes`);

        try {
            const startTime = Date.now();
            const result = await this.sttService.transcribeBase64Audio(audioData, mimeType);
            const processingTime = Date.now() - startTime;

            this.logger.log(
                `STT 변환 완료: ${result.transcript} (신뢰도: ${(result.confidence * 100).toFixed(1)}%)`,
            );
            return { success: true, timestamp: new Date().toISOString(), processingTime, result };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`STT 변환 실패: ${message}`);
            throw new InternalServerErrorException(`STT 변환 실패: ${message}`);
        }
    }

    @Get('sample')
    getSample(): SampleResponse {
        const sample = this.sttService.createSampleResult();
        this.logger.log(
            `샘플 STT 결과 테스트: ${sample.transcript} (신뢰도: ${(sample.confidence * 100).toFixed(1)}%)`,
        );
        sample.speakers?.forEach((wordSegment, i) =>
            this.logger.log(
                `단어 ${i + 1}: "${wordSegment.text_Content}" (${wordSegment.startTime}s - ${wordSegment.endTime}s)`,
            ),
        );
        return { success: true, message: '샘플 STT 결과', result: sample };
    }

    private validateAudioFile(file: Express.Multer.File): void {
        const maxSize = 10 * 1024 * 1024;
        const allowedTypes = ['audio/wav', 'audio/mp3', 'audio/webm', 'audio/flac', 'audio/mpeg'];
        if (file.size > maxSize)
            throw new BadRequestException('파일 크기는 10MB를 초과할 수 없습니다.');
        if (!allowedTypes.includes(file.mimetype))
            throw new BadRequestException(`지원되지 않는 파일 형식: ${file.mimetype}`);
        if (file.size === 0) throw new BadRequestException('빈 파일입니다.');
    }

    private isValidBase64(str: string): boolean {
        try {
            if (!/^[A-Za-z0-9+/]*={0,2}$/.test(str) || str.length % 4 !== 0) return false;
            Buffer.from(str, 'base64');
            return true;
        } catch {
            return false;
        }
    }

    private mapSpeakersToUsers(
        speakers:
            | Array<{
                  speakerTag: number;
                  text_Content: string;
                  startTime: number;
                  endTime: number;
              }>
            | undefined,
        mentorIdx: number,
        menteeIdx: number,
    ): Array<{ userId: number; text_Content: string; startTime: number; endTime: number }> {
        if (!speakers) return [];

        return speakers.map((speaker) => ({
            userId: speaker.speakerTag === 1 ? mentorIdx : menteeIdx,
            text_Content: speaker.text_Content,
            startTime: speaker.startTime,
            endTime: speaker.endTime,
        }));
    }

    @Post('transcribe-chunk')
    async transcribeChunk(@Body() body: TranscribeChunkRequest): Promise<ChunkResponse> {
        const startTime = Date.now();
        const { audioData, mimeType, canvasIdx, chunkIdx, mentorIdx, menteeIdx, duration } = body;

        try {
            // 1. Base64를 Buffer로 변환
            const audioBuffer = Buffer.from(audioData, 'base64');

            // 2. S3 키 생성 (fileS3Key 함수 사용)
            const s3Key = fileS3Key(
                `recording-chunk-${chunkIdx}`,
                mimeType,
                canvasIdx,
                mentorIdx,
                menteeIdx,
                undefined, // speakerTag는 STT에서 결정
            );
            const s3Result = await uploadFileToS3(audioBuffer, s3Key, mimeType);

            // 3. STT 처리
            const sttResult = await this.sttService.transcribeAudioBuffer(audioBuffer, mimeType);

            // 4. 시간 정규화 (duration이 있으면)
            let normalizedSpeakers = sttResult.speakers || [];
            if (duration && duration > 0) {
                normalizedSpeakers = this.sttService.normalizeTimings(normalizedSpeakers, duration);
            }

            // 5. 화자 매핑
            const mappedSpeakers = this.mapSpeakersToUsers(
                normalizedSpeakers,
                mentorIdx,
                menteeIdx,
            );

            // 6. 청크 세션을 DB에 저장
            const chunkSessionIdx = await this.databaseService.query(
                `INSERT INTO stt_transcriptions 
             (canvas_idx, mentor_idx, mentee_idx, audio_url, created_at) 
             VALUES (?, ?, ?, ?, NOW())`,
                [canvasIdx, mentorIdx, menteeIdx, s3Result.url],
            );

            // 7. 화자 세그먼트 저장 (시간 오프셋 적용)
            const timeOffset = chunkIdx * 300; // 5분 = 300초
            for (const segment of mappedSpeakers) {
                await this.databaseService.query(
                    `INSERT INTO stt_speaker_segments 
                 (stt_session_idx, speaker_idx, text_content, start_time, end_time, created_at) 
                 VALUES (?, ?, ?, ?, ?, NOW())`,
                    [
                        chunkSessionIdx,
                        segment.userId === mentorIdx ? 0 : 1,
                        segment.text_Content,
                        segment.startTime + timeOffset,
                        segment.endTime + timeOffset,
                    ],
                );
            }

            const chunkProcessingTime = Date.now() - startTime;
            this.logger.log(`청크 STT 처리 시간: ${chunkProcessingTime}ms`);

            return {
                success: true,
                chunkIndex: chunkIdx,
                s3Url: s3Result.url || '',
                sttSessionIdx:
                    typeof chunkSessionIdx === 'object' && 'insertId' in chunkSessionIdx
                        ? (chunkSessionIdx as { insertId: number }).insertId
                        : 0,
                speakers: mappedSpeakers.map((seg) => ({
                    speakerTag: seg.userId === mentorIdx ? 0 : 1,
                    textContent: seg.text_Content,
                    startTime: seg.startTime + timeOffset,
                    endTime: seg.endTime + timeOffset,
                })),
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`청크 STT 실패: ${message}`);
            throw new InternalServerErrorException(`청크 STT 처리 실패: ${message}`);
        }
    }

    @Post('merge-chunks')
    async mergeChunks(@Body() body: MergeChunksRequest): Promise<STTWithContextResponse> {
        const { canvasIdx, mentorIdx, menteeIdx } = body;
        const startTime = Date.now();

        try {
            // 1. 모든 청크 조회 (created_at으로 정렬)
            const chunks = await this.databaseService.query(
                `SELECT * FROM stt_transcriptions 
             WHERE canvas_idx = ? 
             ORDER BY created_at`,
                [canvasIdx],
            );

            if (chunks.length === 0) {
                throw new BadRequestException('병합할 청크가 없습니다');
            }

            // 2. 모든 화자 세그먼트 조회
            const allSpeakers = Array<{
                speaker_idx: number;
                text_content: string;
                start_time: number;
                end_time: number;
            }>();
            for (const chunk of chunks) {
                const segments = await this.databaseService.query(
                    `SELECT * FROM stt_speaker_segments 
                 WHERE stt_session_idx = ? 
                 ORDER BY start_time`,
                    [(chunk as { stt_session_idx: number }).stt_session_idx],
                );
                allSpeakers.push(
                    ...(segments as {
                        speaker_idx: number;
                        text_content: string;
                        start_time: number;
                        end_time: number;
                    }[]),
                );
            }

            // 3. 최종 세션 생성 (fileS3Key 함수 사용)
            const finalTimestamp = Date.now();
            const finalS3Key = fileS3Key(
                `recording-final-${finalTimestamp}`,
                'audio/webm',
                canvasIdx,
                mentorIdx,
                menteeIdx,
                undefined,
            );
            const finalS3Result = await uploadFileToS3(Buffer.alloc(0), finalS3Key, 'audio/webm');

            const finalSessionIdx = await this.databaseService.query(
                `INSERT INTO stt_transcriptions 
             (canvas_idx, mentor_idx, mentee_idx, audio_url, created_at) 
             VALUES (?, ?, ?, ?, NOW())`,
                [canvasIdx, mentorIdx, menteeIdx, finalS3Result.url],
            );

            // 4. 화자 세그먼트를 최종 세션으로 이동
            for (const segment of allSpeakers) {
                await this.databaseService.query(
                    `INSERT INTO stt_speaker_segments 
                 (stt_session_idx, speaker_idx, text_content, start_time, end_time, created_at) 
                 VALUES (?, ?, ?, ?, ?, NOW())`,
                    [
                        (finalSessionIdx as unknown as { insertId: number }).insertId,
                        segment.speaker_idx,
                        segment.text_content,
                        segment.start_time,
                        segment.end_time,
                    ],
                );
            }

            // 5. 컨텍스트 텍스트 생성
            const contextText = this.extractContextText(
                allSpeakers.map((seg) => ({
                    speakerTag: seg.speaker_idx,
                    text: seg.text_content,
                    startTime: seg.start_time,
                    endTime: seg.end_time,
                })),
            );

            return {
                success: true,
                timestamp: new Date().toISOString(),
                processingTime: Date.now() - startTime,
                sttSessionIdx: (finalSessionIdx as unknown as { insertId: number }).insertId,
                contextText,
                audioUrl: finalS3Result.url || '',
                speakers: allSpeakers.map((seg) => ({
                    speakerTag: seg.speaker_idx,
                    textContent: seg.text_content,
                    startTime: seg.start_time,
                    endTime: seg.end_time,
                })),
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`청크 병합 실패: ${message}`);
            throw new InternalServerErrorException(`청크 병합 실패: ${message}`);
        }
    }
}

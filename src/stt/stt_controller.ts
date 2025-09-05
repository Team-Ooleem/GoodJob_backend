// stt.controller.ts
import {
    Controller,
    Get,
    Post,
    Body,
    BadRequestException,
    InternalServerErrorException,
    Logger,
    Param,
    UploadedFile,
    UseInterceptors,
} from '@nestjs/common';

import { STTService, STTResult } from './stt_service';
import { uploadFileToS3, fileS3Key } from '../lib/s3';
import { DatabaseService } from '../database/database.service';
import { FileInterceptor } from '@nestjs/platform-express';

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
    speakers: Array<{
        speakerTag: number;
        textContent: string; // ✅ text_Content → textContent로 통일
        startTime: number;
        endTime: number;
    }>;
}

interface ChatMessage {
    messageId: number;
    contextText: string;
    audioUrl: string;
    timestamp: string;
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

@Controller('stt')
export class STTController {
    private readonly logger = new Logger(STTController.name);

    constructor(
        private readonly sttService: STTService,
        private readonly databaseService: DatabaseService,
    ) {}

    // 화자 분리 + 컨텍스트 추출 + DB 저장
    @Post('transcribe-with-context')
    async transcribeWithContext(
        @Body() body: TranscribeWithContextRequest,
    ): Promise<STTWithContextResponse> {
        const { audioData, mimeType = 'audio/webm', canvasIdx, mentorIdx, menteeIdx } = body;

        if (!audioData) throw new BadRequestException('오디오 데이터가 없습니다.');
        if (!this.isValidBase64(audioData))
            throw new BadRequestException('유효하지 않은 Base64 데이터입니다.');

        this.logger.log(
            `화자 분리 STT 요청: canvasIdx=${canvasIdx}, mentorIdx=${mentorIdx}, menteeIdx=${menteeIdx}`,
        );

        try {
            const startTime = Date.now();

            // 1. STT 변환 (Base64 데이터를 Buffer로 변환)
            const audioBuffer = Buffer.from(audioData, 'base64');
            const sttResult = await this.sttService.transcribeAudioBuffer(audioBuffer, mimeType);

            // 2. 오디오 파일 S3 업로드
            const s3Key = fileS3Key('voice_recording', mimeType);
            const s3Result = await uploadFileToS3(audioBuffer, s3Key, mimeType);

            if (!s3Result?.success) throw new Error('오디오 파일 업로드 실패');

            // 3. STT 세션 정보 DB 저장
            const insertSessionResult = await this.databaseService.query(
                'INSERT INTO stt_transcriptions (canvas_idx, mentor_idx, mentee_idx, audio_url, created_at) VALUES (?, ?, ?, ?, NOW())',
                [canvasIdx, mentorIdx, menteeIdx, s3Result.url],
            );

            const sttSessionIdx = (insertSessionResult[0] as { insertId: number }).insertId;

            // 4. 화자별 세그먼트를 DB에 저장
            if (sttResult.speakers && sttResult.speakers.length > 0) {
                for (const wordSegment of sttResult.speakers) {
                    await this.databaseService.query(
                        'INSERT INTO stt_speaker_segments (stt_session_idx, speaker_idx, text_content, start_time, end_time, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
                        [
                            sttSessionIdx,
                            wordSegment.speakerTag || 0, // 실제 화자 ID 사용, 없으면 0
                            wordSegment.text_Content, // DB 컬럼명과 일치
                            wordSegment.startTime,
                            wordSegment.endTime,
                        ],
                    );
                }
            }

            // 5. 컨텍스트 추출
            const wordSegments =
                sttResult.speakers?.map((wordSegment) => ({
                    speakerTag: wordSegment.speakerTag || 0,
                    textContent: wordSegment.text_Content, // camelCase로 변환
                    startTime: wordSegment.startTime,
                    endTime: wordSegment.endTime,
                })) || [];

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
    async getSessionMessages(@Param('canvasIdx') canvasIdx: number): Promise<ChatMessagesResponse> {
        try {
            const sessions = await this.databaseService.query(
                `
                SELECT 
                    st.stt_session_idx,
                    st.audio_url,
                    st.created_at,
                    mentor.name as mentor_name,
                    mentee.name as mentee_name
                FROM stt_transcriptions st
                JOIN users mentor ON st.mentor_idx = mentor.user_id
                JOIN users mentee ON st.mentee_idx = mentee.user_id
                WHERE st.canvas_idx = ?
                ORDER BY st.created_at DESC
            `,
                [canvasIdx],
            );

            const messages: ChatMessage[] = [];
            for (const session of sessions as {
                stt_session_idx: number;
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
                    speakerInfo: {
                        mentor: session.mentor_name,
                        mentee: session.mentee_name,
                    },
                    canvasIdx: canvasIdx,
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
    async getMessageDetail(@Param('sessionIdx') sessionIdx: number) {
        try {
            const sessionInfo = await this.databaseService.query(
                `
                SELECT 
                    st.*,
                    mentor.name as mentor_name,
                    mentee.name as mentee_name
                FROM stt_transcriptions st
                JOIN users mentor ON st.mentor_idx = mentor.user_id
                JOIN users mentee ON st.mentee_idx = mentee.user_id
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

    @Post('transcribe-file')
    @UseInterceptors(
        FileInterceptor('file', {
            limits: { fileSize: 10 * 1024 * 1024 }, // 10MB 제한 (필요시 조정)
        }),
    )
    async transcribeFile(@UploadedFile() file: Express.Multer.File) {
        if (!file) throw new BadRequestException('파일이 없습니다.');
        // (선택) 파일 검증 재활용
        // this.validateAudioFile(file);

        try {
            const start = Date.now();
            const result = await this.sttService.transcribeAudioBuffer(file.buffer, file.mimetype);
            const processingTime = Date.now() - start;
            return {
                success: true,
                timestamp: new Date().toISOString(),
                processingTime,
                result,
            };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new InternalServerErrorException(`STT 변환 실패: ${msg}`);
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
}

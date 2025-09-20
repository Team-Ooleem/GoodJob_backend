import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PynoteResponse } from '../entities/transcription';

@Injectable()
export class PynoteService {
    private readonly logger = new Logger(PynoteService.name);
    private readonly serviceUrl: string;
    private readonly apiKey: string;

    constructor() {
        this.serviceUrl = process.env.PYNOTE_SERVICE_URL || 'http://localhost:8081';
        this.apiKey = process.env.HF_TOKEN || '';

        // 초기화 로그 추가
        this.logger.log(`PynoteService 초기화 완료 - URL: ${this.serviceUrl}`);

        // 환경변수 검증 추가
        if (!this.apiKey) {
            this.logger.warn(
                'PYNOTE_API_KEY가 설정되지 않았습니다. 화자분리가 작동하지 않을 수 있습니다.',
            );
        } else {
            this.logger.log('PYNOTE_API_KEY 설정됨');
        }
    }

    // 🆕 GCS URL을 사용한 화자분리 (새로운 메서드)
    async diarizeAudioFromGcs(gcsUrl: string): Promise<any> {
        try {
            this.logger.log(`pynote GCS 화자분리 시작: ${gcsUrl}`);

            // Form Data로 변경
            const formData = new FormData();
            formData.append('gcs_url', gcsUrl);
            formData.append('token', this.apiKey);

            const response = await axios.post(
                `${this.serviceUrl}/diarization/diarize-audio-from-gcs`,
                formData, // ✅ Form Data로 전송
                {
                    headers: {
                        'Content-Type': 'multipart/form-data', // ✅ Form Data 헤더
                    },
                    timeout: 60000,
                },
            );

            this.logger.log(
                `pynote GCS 화자분리 완료: ${(response.data as PynoteResponse)?.speaker_segments?.length || 0}개 세그먼트`,
            );

            return response.data;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`pynote GCS 화자분리 실패: ${errorMessage}`);
            return { success: false, speaker_segments: [] };
        }
    }

    // 기존 메서드 유지 (하위 호환성)
    async diarizeAudio(audioBuffer: Buffer): Promise<any> {
        try {
            const formData = new FormData();
            formData.append('file', new Blob([new Uint8Array(audioBuffer)]), 'audio.wav');
            formData.append('token', this.apiKey);

            const response = await axios.post(
                `${this.serviceUrl}/diarization/diarize-audio`,
                formData,
                {
                    headers: { 'Content-Type': 'multipart/form-data' },
                    timeout: 60000,
                },
            );

            return response.data;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`pynote 화자분리 실패: ${errorMessage}`);
            return { success: false, speaker_segments: [] };
        }
    }

    async getSegmentsFromGcs(
        gcsUrl: string,
        canvasId: string,
        mentorIdx: number,
        menteeIdx: number,
        sessionStartOffset: number = 0,
    ): Promise<{
        success: boolean;
        segments: Array<{
            audioBuffer: string;
            startTime: number;
            endTime: number;
            speakerTag: number;
        }>;
    }> {
        try {
            this.logger.log(`🎯 pynote GCS 세그먼트 분리 시작: ${gcsUrl}`);

            const formData = new FormData();
            formData.append('gcs_url', gcsUrl);
            formData.append('token', this.apiKey);
            formData.append('canvas_id', canvasId);
            formData.append('mentor_idx', mentorIdx.toString());
            formData.append('mentee_idx', menteeIdx.toString());
            formData.append('session_start_offset', sessionStartOffset.toString());

            // 🔧 pyannote 정확도 조절 파라미터 추가
            formData.append('min_duration_on', '1.0'); // 최소 발화 시간 (초)
            formData.append('min_duration_off', '0.5'); // 최소 침묵 시간 (초)
            formData.append('num_speakers', '2'); // 고정 화자 수 (멘토-멘티)
            formData.append('merge_threshold', '2.0'); // 짧은 세그먼트 병합 임계값 (초)

            const response = await axios.post(
                `${this.serviceUrl}/diarization/get-segments-from-gcs`,
                formData,
                {
                    headers: {
                        'Content-Type': 'multipart/form-data',
                    },
                    timeout: 60000,
                },
            );

            const responseData = response.data as { segments?: Array<any> };
            this.logger.log(
                `✅ pynote GCS 세그먼트 분리 완료: ${responseData?.segments?.length || 0}개 세그먼트`,
            );

            return response.data as {
                success: boolean;
                segments: Array<{
                    audioBuffer: string;
                    startTime: number;
                    endTime: number;
                    speakerTag: number;
                }>;
            };
        } catch (error) {
            this.logger.error(
                `pynote GCS 세그먼트 분리 실패: ${error instanceof Error ? error.message : String(error)}`,
            );
            return { success: false, segments: [] };
        }
    }
}

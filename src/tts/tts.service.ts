import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import type { protos } from '@google-cloud/text-to-speech';
import { SynthesizeSpeechDto } from './dto/tts.dto';
import { AppConfigService } from '../config/config.service';

// Google Cloud Text-to-Speech 타입 사용
type ISynthesizeSpeechRequest = protos.google.cloud.texttospeech.v1.ISynthesizeSpeechRequest;
type AudioEncoding = protos.google.cloud.texttospeech.v1.AudioEncoding;

@Injectable()
export class TTSService {
    private readonly logger = new Logger(TTSService.name);
    private textToSpeechClient: TextToSpeechClient | null = null;

    constructor(private readonly configService: AppConfigService) {
        try {
            if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
                this.logger.warn(
                    'Google Cloud 인증 정보가 설정되지 않았습니다. TTS 기능이 비활성화됩니다.',
                );
                return;
            }

            this.textToSpeechClient = new TextToSpeechClient();
            this.logger.log('Google Text-to-Speech Client 초기화 완료');
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            this.logger.error(`Text-to-Speech Client 초기화 실패: ${msg}`);
            this.textToSpeechClient = null;
        }
    }

    // 오디오 인코딩 타입을 올바르게 변환하는 헬퍼 함수
    private getAudioEncoding(encoding: string): AudioEncoding {
        switch (encoding.toUpperCase()) {
            case 'MP3':
                return 'MP3' as unknown as AudioEncoding;
            case 'LINEAR16':
                return 'LINEAR16' as unknown as AudioEncoding;
            case 'OGG_OPUS':
                return 'OGG_OPUS' as unknown as AudioEncoding;
            case 'MULAW':
                return 'MULAW' as unknown as AudioEncoding;
            case 'ALAW':
                return 'ALAW' as unknown as AudioEncoding;
            default:
                return 'MP3' as unknown as AudioEncoding;
        }
    }
    async synthesizeSpeech(dto: SynthesizeSpeechDto): Promise<Buffer> {
        if (!this.textToSpeechClient) {
            throw new BadRequestException('TTS 서비스가 설정되지 않았습니다.');
        }

        // 텍스트 길이 제한 (Google Cloud 제한: 5000자)
        if (dto.text.length > 5000) {
            throw new BadRequestException('텍스트가 너무 깁니다. 5000자 이하로 작성해주세요.');
        }

        const request: ISynthesizeSpeechRequest = {
            input: {
                text: dto.text,
            },
            voice: {
                languageCode: dto.languageCode || 'ko-KR',
                name: dto.voiceName || 'ko-KR-Chirp3-HD-Charon',
            },
            audioConfig: {
                audioEncoding: this.getAudioEncoding(dto.audioEncoding || 'MP3'),
                speakingRate: dto.speakingRate || 1.0,
                pitch: dto.pitch || 0.0,
            },
        };

        try {
            this.logger.log(`TTS 요청: ${dto.text.substring(0, 50)}...`);

            const [response] = await this.textToSpeechClient.synthesizeSpeech(request);

            if (!response.audioContent) {
                throw new BadRequestException('오디오 콘텐츠를 생성할 수 없습니다.');
            }

            // audioContent를 Buffer로 변환
            const audioBuffer = Buffer.from(response.audioContent as Uint8Array);

            this.logger.log(`TTS 성공: ${audioBuffer.length} bytes 생성`);
            return audioBuffer;
        } catch (error) {
            this.logger.error('TTS 처리 중 오류 발생:', error);

            if (error instanceof BadRequestException) {
                throw error;
            }

            throw new BadRequestException('TTS 서비스 처리 중 오류가 발생했습니다.');
        }
    }

    // 사용 가능한 음성 목록 조회
    async getAvailableVoices(languageCode: string = 'ko-KR') {
        if (!this.textToSpeechClient) {
            throw new BadRequestException('TTS 서비스가 설정되지 않았습니다.');
        }

        try {
            const [response] = await this.textToSpeechClient.listVoices({
                languageCode: languageCode,
            });

            return response.voices || [];
        } catch (error) {
            this.logger.error('음성 목록 조회 중 오류:', error);
            throw new BadRequestException('음성 목록 조회에 실패했습니다.');
        }
    }

    // 헬스체크용 간단한 TTS 테스트
    async healthCheck(): Promise<boolean> {
        if (!this.textToSpeechClient) {
            return false;
        }

        try {
            await this.synthesizeSpeech({
                text: '테스트',
                languageCode: 'ko-KR',
                voiceName: 'ko-KR-Chirp3-HD-Charon',
                audioEncoding: 'MP3',
            });
            return true;
        } catch (error) {
            this.logger.error('TTS 헬스체크 실패:', error);
            return false;
        }
    }

    // 연결 테스트
    async testConnection(): Promise<{ status: 'success' | 'error'; message: string }> {
        if (!this.textToSpeechClient) {
            return { status: 'error', message: 'Text-to-Speech Client가 초기화되지 않았습니다.' };
        }

        try {
            const testRequest: ISynthesizeSpeechRequest = {
                input: { text: '테스트' },
                voice: {
                    languageCode: 'ko-KR',
                    name: 'ko-KR-Chirp3-HD-Charon',
                },
                audioConfig: {
                    audioEncoding: this.getAudioEncoding('MP3'),
                },
            };

            const [response] = await this.textToSpeechClient.synthesizeSpeech(testRequest);
            return { status: 'success', message: 'Google TTS API 연결 성공' };
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            return { status: 'error', message: `연결 실패: ${msg}` };
        }
    }
}

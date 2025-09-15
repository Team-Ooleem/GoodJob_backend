import { Injectable, Logger } from '@nestjs/common';
import * as ffmpeg from 'fluent-ffmpeg';
import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg';
import { path as ffprobePath } from '@ffprobe-installer/ffprobe';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

@Injectable()
export class AudioDurationService {
    private readonly logger = new Logger(AudioDurationService.name);

    constructor() {
        // FFmpeg 경로 설정
        ffmpeg.setFfmpegPath(ffmpegPath);
        ffmpeg.setFfprobePath(ffprobePath);
    }

    /**
     * MP4 파일의 정확한 총 길이를 초 단위로 반환
     */
    async getExactDuration(audioBuffer: Buffer, mimeType: string): Promise<number> {
        return new Promise((resolve) => {
            // Remove 'reject' parameter
            const tempFile = path.join(
                os.tmpdir(),
                `temp_${Date.now()}.${this.getFileExtension(mimeType)}`,
            );

            try {
                // 임시 파일 생성
                fs.writeFileSync(tempFile, audioBuffer);

                this.logger.log(` 임시 파일 생성: ${tempFile}`);

                ffmpeg.ffprobe(tempFile, (err, metadata) => {
                    // 임시 파일 삭제
                    try {
                        fs.unlinkSync(tempFile);
                    } catch (unlinkErr) {
                        this.logger.warn(`임시 파일 삭제 실패: ${unlinkErr}`);
                    }

                    if (err) {
                        this.logger.warn(
                            `Duration 추출 실패: ${err instanceof Error ? err.message : String(err)}`,
                        );
                        // 기본값: 버퍼 크기 기반 추정
                        const estimatedDuration = this.estimateDurationFromBuffer(
                            audioBuffer,
                            mimeType,
                        );
                        resolve(estimatedDuration);
                        return;
                    }

                    const durationValue = metadata.format.duration;
                    const duration = durationValue ? parseFloat(String(durationValue)) : 0;
                    this.logger.log(`🎬 정확한 MP4 길이: ${duration.toFixed(3)}초`);
                    resolve(duration);
                });
            } catch (error) {
                this.logger.warn(`파일 생성 실패: ${error}`);
                const estimatedDuration = this.estimateDurationFromBuffer(audioBuffer, mimeType);
                resolve(estimatedDuration);
            }
        });
    }

    /**
     * STT 시간을 전체 MP4 길이에 맞게 정확히 매핑 (DB 저장용 - 소수점 첫째 자리)
     */
    mapSTTTimingsToFullDuration(
        sttSpeakers: Array<{
            text_Content: string;
            startTime: number;
            endTime: number;
            speakerTag: number;
        }>,
        sttDuration: number,
        fullMP4Duration: number,
        sessionStartOffset: number = 0,
    ): Array<{ text_Content: string; startTime: number; endTime: number; speakerTag: number }> {
        if (sttSpeakers.length === 0 || sttDuration <= 0 || fullMP4Duration <= 0) {
            this.logger.warn('유효하지 않은 시간 데이터로 매핑 건너뜀');
            return sttSpeakers;
        }

        // STT 결과의 최대 시간
        const maxSTTTime = Math.max(...sttSpeakers.map((s) => s.endTime));

        // STT duration과 실제 STT 결과 시간의 비율
        const sttScaleFactor = sttDuration / maxSTTTime;

        // 전체 MP4 duration에 맞는 스케일 팩터
        const fullScaleFactor = fullMP4Duration / sttDuration;

        this.logger.log(` 시간 매핑 정보:`);
        this.logger.log(`  - STT 결과 최대시간: ${maxSTTTime.toFixed(3)}초`);
        this.logger.log(`  - STT duration: ${sttDuration.toFixed(3)}초`);
        this.logger.log(`  - 전체 MP4 duration: ${fullMP4Duration.toFixed(3)}초`);
        this.logger.log(`  - STT 스케일 팩터: ${sttScaleFactor.toFixed(3)}`);
        this.logger.log(`  - 전체 스케일 팩터: ${fullScaleFactor.toFixed(3)}`);
        this.logger.log(`  - 세션 오프셋: ${sessionStartOffset.toFixed(3)}초`);

        // 정확한 시간 매핑 (DB 저장용 - 소수점 첫째 자리)
        const mappedSpeakers = sttSpeakers.map((speaker) => {
            // 1. STT 결과 시간을 STT duration에 맞게 정규화
            const normalizedStartTime = speaker.startTime * sttScaleFactor;
            const normalizedEndTime = speaker.endTime * sttScaleFactor;

            // 2. 전체 MP4 duration에 맞게 스케일링
            const scaledStartTime = normalizedStartTime * fullScaleFactor;
            const scaledEndTime = normalizedEndTime * fullScaleFactor;

            // 3. 세션 시작 오프셋 추가
            const finalStartTime = scaledStartTime + sessionStartOffset;
            const finalEndTime = scaledEndTime + sessionStartOffset;

            return {
                ...speaker,
                startTime: Math.round(finalStartTime * 10) / 10, // 🆕 DB 저장용: 소수점 첫째 자리
                endTime: Math.round(finalEndTime * 10) / 10, // 🆕 DB 저장용: 소수점 첫째 자리
            };
        });

        this.logger.log(`✅ 시간 매핑 완료: ${mappedSpeakers.length}개 세그먼트`);
        mappedSpeakers.forEach((speaker, i) => {
            this.logger.log(
                `  세그먼트 ${i}: "${speaker.text_Content}" (${speaker.startTime}s-${speaker.endTime}s)`,
            );
        });

        return mappedSpeakers;
    }

    /**
     * 버퍼 크기 기반 duration 추정
     */
    private estimateDurationFromBuffer(buffer: Buffer, mimeType: string): number {
        // MP4 파일의 경우 일반적인 비트레이트로 추정
        const bitrateMap: Record<string, number> = {
            'audio/mp4': 128000, // 128kbps
            'video/mp4': 1000000, // 1Mbps
            'audio/mpeg': 128000,
            'audio/wav': 1411200, // 16bit, 44.1kHz
        };

        const bitrate = bitrateMap[mimeType] || 128000;
        const estimatedDuration = (buffer.length * 8) / bitrate;

        this.logger.log(
            `📊 추정 duration: ${estimatedDuration.toFixed(3)}초 (${mimeType}, ${bitrate}bps)`,
        );
        return estimatedDuration;
    }

    /**
     * MIME 타입에서 파일 확장자 추출
     */
    private getFileExtension(mimeType: string): string {
        const extensions: Record<string, string> = {
            'audio/mp4': 'mp4',
            'audio/mpeg': 'mp3',
            'audio/wav': 'wav',
            'audio/webm': 'webm',
            'audio/ogg': 'ogg',
            'video/mp4': 'mp4',
            'video/webm': 'webm',
        };

        return extensions[mimeType] || 'mp4';
    }
}

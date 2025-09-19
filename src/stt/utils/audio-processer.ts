import { parseBuffer } from 'music-metadata';

export class AudioProcessorUtil {
    static async getAudioDuration(audioBuffer: Buffer, mimeType: string): Promise<number> {
        try {
            // 1️⃣ music-metadata로 정확한 duration 추출
            const metadata = await parseBuffer(audioBuffer, mimeType);
            if (metadata.format.duration && metadata.format.duration > 0) {
                console.log(`정확한 duration: ${metadata.format.duration.toFixed(2)}초`);
                return metadata.format.duration;
            }

            // 2️⃣ duration이 없는 경우 fallback
            console.warn(`metadata에서 duration을 찾을 수 없음 → 추정값 사용`);
            const estimatedDuration = this.estimateDurationByFormat(audioBuffer, mimeType);
            return estimatedDuration || 0; // undefined인 경우 0 반환
        } catch (error) {
            // 3️⃣ 파싱 실패 시 fallback
            const estimatedDuration = this.estimateDurationByFormat(audioBuffer, mimeType);
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.warn(
                `Duration 계산 실패, 추정값 사용: ${estimatedDuration.toFixed(2)}초 - ${errorMessage}`,
            );
            return estimatedDuration || 0; // undefined인 경우 0 반환
        }
    }

    // 🆕 포맷별 duration 추정
    static estimateDurationByFormat(audioBuffer: Buffer, mimeType: string): number {
        if (mimeType.includes('wav')) {
            // WAV: 16-bit, 44.1kHz 기준
            const sampleRate = 44100;
            const channels = 2;
            const bitsPerSample = 16;
            const bytesPerSecond = (sampleRate * channels * bitsPerSample) / 8;
            return audioBuffer.length / bytesPerSecond;
        } else if (mimeType.includes('webm')) {
            // WebM: 일반적으로 128 kbps
            const bitrate = 128 * 1000;
            return (audioBuffer.length * 8) / bitrate;
        } else if (mimeType.includes('mp4')) {
            // MP4/AAC: 더 높은 비트레이트 사용
            const bitrate = 256 * 1000; // 256 kbps로 증가
            return (audioBuffer.length * 8) / bitrate;
        } else {
            // 기본값: 더 높은 비트레이트
            const bitrate = 256 * 1000;
            return (audioBuffer.length * 8) / bitrate;
        }
    }

    // 🆕 Duration 품질 검증
    static validateDurationQuality(
        calculatedDuration: number,
        audioBuffer: Buffer,
        mimeType: string,
    ): {
        isValid: boolean;
        confidence: number;
        message: string;
    } {
        const estimatedDuration = this.estimateDurationByFormat(audioBuffer, mimeType);
        const difference = Math.abs(calculatedDuration - estimatedDuration);
        const ratio = difference / Math.max(calculatedDuration, estimatedDuration);

        let confidence = 1.0;
        let message = 'Duration 계산이 정확합니다.';

        if (ratio > 0.5) {
            confidence = 0.3;
            message = 'Duration 계산에 큰 불일치가 있습니다.';
        } else if (ratio > 0.2) {
            confidence = 0.6;
            message = 'Duration 계산에 중간 정도의 불일치가 있습니다.';
        } else if (ratio > 0.1) {
            confidence = 0.8;
            message = 'Duration 계산에 작은 불일치가 있습니다.';
        }

        return {
            isValid: confidence > 0.5,
            confidence,
            message,
        };
    }

    static convertToGcsUri(gcsUrl: string): string {
        if (gcsUrl.startsWith('gs://')) return gcsUrl;
        if (gcsUrl.includes('storage.googleapis.com')) {
            const match = gcsUrl.match(/storage\.googleapis\.com\/([^/]+)\/(.+)/);
            if (match) return `gs://${match[1]}/${match[2]}`;
        }
        return gcsUrl;
    }

    static mergeAudioBuffers(buffers: Buffer[]): Buffer {
        if (!buffers || buffers.length === 0) {
            throw new Error('병합할 버퍼가 없습니다');
        }

        if (buffers.length === 1) {
            return buffers[0];
        }

        try {
            // Buffer.concat을 사용하여 여러 오디오 버퍼를 하나로 병합
            const mergedBuffer = Buffer.concat(buffers);
            console.log(
                `오디오 병합 완료: ${buffers.length}개 버퍼 → ${mergedBuffer.length} bytes`,
            );
            return mergedBuffer;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`오디오 병합 실패: ${errorMessage}`);
            throw new Error(`오디오 병합 실패: ${errorMessage}`);
        }
    }

    static mergeAudioBuffersWav(audioBuffers: Buffer[]): Buffer {
        try {
            if (!audioBuffers || audioBuffers.length === 0) {
                throw new Error('오디오 버퍼가 없습니다');
            }

            if (audioBuffers.length === 1) {
                return audioBuffers[0];
            }

            // WAV 파일 병합을 위한 헤더 분석 및 데이터 추출
            const audioDataChunks: Buffer[] = [];
            let totalDataSize = 0;
            let sampleRate = 44100; // 기본값
            let channels = 2; // 기본값
            let bitsPerSample = 16; // 기본값

            for (let i = 0; i < audioBuffers.length; i++) {
                const buffer = audioBuffers[i];

                try {
                    // WAV 헤더인지 확인 (RIFF 시그니처)
                    if (buffer.length >= 44 && buffer.toString('ascii', 0, 4) === 'RIFF') {
                        // WAV 파일인 경우 헤더 정보 추출
                        if (i === 0) {
                            // 첫 번째 파일에서 오디오 포맷 정보 추출
                            channels = buffer.readUInt16LE(22);
                            sampleRate = buffer.readUInt32LE(24);
                            bitsPerSample = buffer.readUInt16LE(34);
                            console.log(
                                `오디오 포맷: ${channels}ch, ${sampleRate}Hz, ${bitsPerSample}bit`,
                            );
                        }

                        // data 청크 찾기
                        let dataOffset = 44; // 표준 WAV 헤더 크기
                        let dataChunkFound = false;

                        while (dataOffset < buffer.length - 8) {
                            const chunkId = buffer.toString('ascii', dataOffset, dataOffset + 4);
                            const chunkSize = buffer.readUInt32LE(dataOffset + 4);

                            if (chunkId === 'data') {
                                // 실제 오디오 데이터 추출
                                const audioData = buffer.subarray(
                                    dataOffset + 8,
                                    dataOffset + 8 + chunkSize,
                                );
                                audioDataChunks.push(audioData);
                                totalDataSize += audioData.length;
                                console.log(
                                    `청크 ${i}: ${audioData.length} bytes 오디오 데이터 추출`,
                                );
                                dataChunkFound = true;
                                break;
                            } else {
                                // 다른 청크는 건너뛰기
                                dataOffset += 8 + chunkSize;
                            }
                        }

                        // data 청크를 찾지 못한 경우 fallback
                        if (!dataChunkFound) {
                            const audioData = buffer.subarray(44); // WAV 헤더 이후 전체 데이터
                            audioDataChunks.push(audioData);
                            totalDataSize += audioData.length;
                        }
                    } else {
                        // WAV가 아닌 경우 전체 버퍼를 오디오 데이터로 간주
                        audioDataChunks.push(buffer);
                        totalDataSize += buffer.length;
                    }
                } catch (error) {
                    console.warn(error);
                    audioDataChunks.push(buffer);
                    totalDataSize += buffer.length;
                }
            }

            // 새로운 WAV 헤더 생성
            const headerSize = 44;
            const fileSize = headerSize + totalDataSize - 8;
            const blockAlign = (channels * bitsPerSample) / 8;
            const byteRate = sampleRate * blockAlign;

            const header = Buffer.alloc(headerSize);
            let offset = 0;

            // RIFF 헤더
            header.write('RIFF', offset);
            offset += 4;
            header.writeUInt32LE(fileSize, offset);
            offset += 4;
            header.write('WAVE', offset);
            offset += 4;

            // fmt 청크
            header.write('fmt ', offset);
            offset += 4;
            header.writeUInt32LE(16, offset);
            offset += 4; // fmt 청크 크기
            header.writeUInt16LE(1, offset);
            offset += 2; // 오디오 포맷 (PCM)
            header.writeUInt16LE(channels, offset);
            offset += 2;
            header.writeUInt32LE(sampleRate, offset);
            offset += 4;
            header.writeUInt32LE(byteRate, offset);
            offset += 4;
            header.writeUInt16LE(blockAlign, offset);
            offset += 2;
            header.writeUInt16LE(bitsPerSample, offset);
            offset += 2;

            // data 청크 헤더
            header.write('data', offset);
            offset += 4;
            header.writeUInt32LE(totalDataSize, offset);

            // 헤더와 모든 오디오 데이터 병합
            const mergedBuffer = Buffer.concat([header, ...audioDataChunks]);

            console.log(`✅ WAV 파일 병합 완료: ${mergedBuffer.length} bytes`);
            console.log(`  - 헤더: ${headerSize} bytes`);
            console.log(`  - 오디오 데이터: ${totalDataSize} bytes`);
            console.log(`  - 포맷: ${channels}ch, ${sampleRate}Hz, ${bitsPerSample}bit`);

            return mergedBuffer;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`오디오 버퍼 합치기 실패: ${errorMessage}`);

            // fallback: 단순 연결
            console.log('Fallback: 단순 버퍼 연결 방식 사용');
            const fallbackBuffer = Buffer.concat(audioBuffers);
            console.log(`Fallback 완료: ${fallbackBuffer.length} bytes`);
            return fallbackBuffer;
        }
    }
}

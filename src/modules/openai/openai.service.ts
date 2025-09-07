import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { toFile } from 'openai/uploads';

@Injectable()
export class OpenAIService {
    private client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

    async transcribeAudio(file: Express.Multer.File) {
        // Multer의 Buffer를 OpenAI SDK가 기대하는 Web File로 변환
        const webFile = await toFile(
            file.buffer, // Buffer | ArrayBuffer | ReadableStream 등 OK
            file.originalname || 'audio.wav',
            { type: file.mimetype || 'audio/wav' },
        );

        const res = await this.client.audio.transcriptions.create({
            file: webFile,
            model: 'whisper-1', // 또는 'gpt-4o-mini-transcribe'
            response_format: 'json',
        });
        return res.text ?? '';
    }

    async chat(messages: { role: 'system' | 'user' | 'assistant'; content: string }[]) {
        const res = await this.client.chat.completions.create({
            model: 'gpt-4o-mini',
            messages,
            temperature: 0.7,
        });
        return res.choices[0]?.message?.content ?? '';
    }
}

import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { CreateCanvasDto } from './dto/create-canvas.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class CanvasService {
    constructor(private readonly db: DatabaseService) {}

    async createCanvas(dto: CreateCanvasDto, userId: number) {
        const canvasId: string = uuidv4();

        return this.db.transaction(async (conn) => {
            // 1. 캔버스 생성
            await conn.execute(`INSERT INTO canvas (id, name, created_by) VALUES (?, ?, ?)`, [
                canvasId,
                dto.name ?? null,
                userId,
            ]);

            // 2. 생성자를 참여자(owner)로 등록
            await conn.execute(
                `INSERT INTO canvas_participant (canvas_id, user_id, role) VALUES (?, ?, ?)`,
                [canvasId, userId, 'owner'],
            );

            return { id: canvasId, name: dto.name, created_by: userId };
        });
    }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class ProfileService {
    constructor(private readonly databaseService: DatabaseService) {}

    async updateProfile(
        userId: number,
        updateData: { short_bio?: string; bio?: string; profile_img?: string },
    ) {
        // 사용자 존재 여부 확인
        const existingUsers = await this.databaseService.query(
            'SELECT idx FROM users WHERE idx = ?',
            [userId],
        );

        if (existingUsers.length === 0) {
            throw new NotFoundException('사용자를 찾을 수 없습니다.');
        }

        // 프로필 업데이트
        const updateFields: string[] = [];
        const updateValues: any[] = [];

        if (updateData.short_bio !== undefined) {
            updateFields.push('short_bio = ?');
            updateValues.push(updateData.short_bio);
        }

        if (updateData.bio !== undefined) {
            updateFields.push('bio = ?');
            updateValues.push(updateData.bio);
        }

        if (updateData.profile_img !== undefined) {
            updateFields.push('profile_img = ?');
            updateValues.push(updateData.profile_img);
        }

        if (updateFields.length === 0) {
            throw new Error('업데이트할 필드가 없습니다.');
        }

        updateFields.push('updated_at = NOW()');
        updateValues.push(userId);

        const updateQuery = `
      UPDATE users 
      SET ${updateFields.join(', ')} 
      WHERE idx = ?
    `;

        await this.databaseService.query(updateQuery, updateValues);

        // 업데이트된 프로필 조회
        const updatedUsers = await this.databaseService.query(
            'SELECT idx, name, phone, email, short_bio, bio, profile_img, created_at, updated_at FROM users WHERE idx = ?',
            [userId],
        );

        const user = updatedUsers[0];

        if (!user) {
            throw new NotFoundException('업데이트된 사용자 정보를 찾을 수 없습니다.');
        }

        return {
            success: true,
            data: {
                idx: user.idx,
                name: user.name,
                phone: user.phone,
                email: user.email,
                short_bio: user.short_bio,
                bio: user.bio,
                created_at: user.created_at,
                updated_at: user.updated_at,
            },
            message: '프로필이 성공적으로 업데이트되었습니다.',
        };
    }

    async getProfile(userId: number) {
        const users = await this.databaseService.query(
            'SELECT idx, name, phone, email, short_bio, bio, created_at, updated_at FROM users WHERE idx = ?',
            [userId],
        );

        const user = users[0];

        if (!user) {
            throw new NotFoundException('사용자를 찾을 수 없습니다.');
        }

        return {
            success: true,
            data: {
                idx: user.idx,
                name: user.name,
                phone: user.phone,
                email: user.email,
                short_bio: user.short_bio,
                bio: user.bio,
                created_at: user.created_at,
                updated_at: user.updated_at,
            },
            message: '프로필을 성공적으로 조회했습니다.',
        };
    }
}

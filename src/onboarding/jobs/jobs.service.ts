import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class JobsService {
    constructor(private readonly databaseService: DatabaseService) {}

    // 직군 카테고리 목록 조회
    async getJobCategories() {
        const query = 'SELECT id, name FROM job_category ORDER BY id';
        return await this.databaseService.query(query);
    }

    // 특정 직군의 직무 목록 조회
    async getJobRolesByCategory(categoryId: number) {
        const query = `
      SELECT id, name 
      FROM job_role 
      WHERE category_id = ? 
      ORDER BY name
    `;
        return await this.databaseService.query(query, [categoryId]);
    }
}

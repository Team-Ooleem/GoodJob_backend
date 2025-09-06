import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class SalariesService {
    constructor(private readonly databaseService: DatabaseService) {}

      // 모든 연봉 구간 조회
  async getAllSalaryRanges() {
    const query = `
      SELECT idx, min_salary, display_text 
      FROM salary_range 
      ORDER BY min_salary ASC
    `;
    return await this.databaseService.query(query);
  }

  // 특정 연봉 구간 조회
  async getSalaryRangeById(id: number) {
    const query = `
      SELECT idx, min_salary, display_text 
      FROM salary_range 
      WHERE idx = ?
    `;
    const result = await this.databaseService.query(query, [id]);
    return result[0] || null;
  }

  // 연봉 구간 검색 (최소 연봉 기준)
  async getSalaryRangesByMinSalary(minSalary: number) {
    const query = `
      SELECT idx, min_salary, display_text 
      FROM salary_range 
      WHERE min_salary >= ?
      ORDER BY min_salary ASC
    `;
    return await this.databaseService.query(query, [minSalary]);
  }
}

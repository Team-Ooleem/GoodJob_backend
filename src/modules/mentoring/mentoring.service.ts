import { Injectable } from '@nestjs/common';
import { MentoringProductDto } from './dto/product.dto';
import { MentoringProductSlotsDto } from './dto/product-slots.dto';

@Injectable()
export class MentoringService {
    getProduct(productIdx: number): MentoringProductDto {
        /*
        SELECT 
            p.product_idx,
            p.title,
            p.description,
            p.price,
            jc.name AS job_category,
            
            -- 리뷰 개수 & 평균 평점
            COUNT(DISTINCT r.review_idx) AS review_count,
            COALESCE(ROUND(AVG(r.rating), 1), 0) AS average_rating,
            
            -- 멘토 정보
            u.name AS mentor_name,
            jc2.name AS mentor_job_category,
            mp.business_name,
            -- 경력 컬럼은 스키마에 없음, 필요시 mentor_profiles에 career 컬럼 추가
            
            -- 멘티 수
            COUNT(DISTINCT a.mentee_idx) AS mentee_count
            
        FROM mentoring_products p
        JOIN mentor_profiles mp ON p.mentor_idx = mp.mentor_idx
        JOIN users u ON mp.user_idx = u.idx
        JOIN job_category jc ON p.job_category_id = jc.id
        JOIN job_category jc2 ON mp.preferred_field_id = jc2.id
        LEFT JOIN mentoring_reviews r ON p.product_idx = r.product_idx
        LEFT JOIN mentoring_applications a 
            ON p.product_idx = a.product_idx 
            AND a.application_status = 'completed'

        WHERE p.product_idx = 1

        GROUP BY 
            p.product_idx, p.title, p.description, p.price, jc.name,
            u.name, jc2.name, mp.business_name;
        */
        return {
            product_idx: productIdx,
            title: '프론트엔드 면접 대비 1:1 멘토링',
            description: '실제 면접 경험 기반으로 포트폴리오와 코딩테스트 준비를 도와드립니다.',
            price: 50000,
            job_category: '프론트엔드 개발',

            mentee_count: 8,
            review_count: 12,
            average_rating: 4.8,

            mentor: {
                name: '홍길동',
                job_category: '프론트엔드 개발',
                career: '5년차',
                business_name: '네이버',
            },
        };
    }

    getProductSlots(productIdx: number): MentoringProductSlotsDto {
        // productIdx는 더미 응답에 직접적 영향을 주지 않지만, 시그니처로 포함
        /*
        -- 1. 날짜로 요일 계산 (MySQL: 1=일요일, 2=월요일 ...)
        SET @date := '2025-09-14';
        SET @day_of_week := DAYOFWEEK(@date); -- 예: 1=일요일

        -- 2. 슬롯 + 예약 건수 조회
        SELECT 
            s.regular_slots_idx,
            s.hour_slot,
            CONCAT(LPAD(s.hour_slot,2,'0'), ':00-', LPAD(s.hour_slot+1,2,'0'), ':00') AS time_range,
            COUNT(a.application_id) AS reserved_count,
            1 AS capacity,
            CASE 
                WHEN COUNT(a.application_id) < 1 THEN TRUE 
                ELSE FALSE 
            END AS available
        FROM mentoring_regular_slots s
        LEFT JOIN mentoring_applications a 
            ON s.regular_slots_idx = a.regular_slots_idx
        AND a.booked_date = @date
        AND a.application_status IN ('approved','completed')
        WHERE s.product_idx = 1
        AND s.day_of_week = @day_of_week
        GROUP BY s.regular_slots_idx, s.hour_slot;

        */
        return {
            date: '2025-09-14',
            day_of_week: 7,
            slots: [
                { hour_slot: 9, time_range: '09:00-10:00', available: false },
                { hour_slot: 10, time_range: '10:00-11:00', available: true },
                { hour_slot: 11, time_range: '11:00-12:00', available: false },
                { hour_slot: 15, time_range: '15:00-16:00', available: true },
            ],
        };
    }
}

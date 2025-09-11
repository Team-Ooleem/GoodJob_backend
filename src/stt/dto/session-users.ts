import { ApiProperty } from '@nestjs/swagger';

export class UserDto {
    @ApiProperty({ description: '사용자 인덱스' })
    idx: number;

    @ApiProperty({ description: '사용자 이름' })
    name: string;
}

export class SessionUsersResponseDto {
    @ApiProperty({ description: '성공 여부' })
    success: boolean;

    @ApiProperty({ description: '캔버스 인덱스' })
    canvasIdx: number;

    @ApiProperty({ description: '멘토 정보', type: UserDto })
    mentor: UserDto;

    @ApiProperty({ description: '멘티 정보', type: UserDto })
    mentee: UserDto;
}

#!/bin/bash

# Mac/Linux용 데이터베이스 설정 스크립트
# UTF-8 인코딩 설정
export LANG=ko_KR.UTF-8

echo "🚀 Good Job 데이터베이스 설정 시작..."
echo ""

# 기본 설정
DB_HOST="localhost"
DB_PORT="3306"
DB_USER="root"
DB_PASSWORD=""
DB_NAME="good_job"

# 사용자 입력 받기
echo "📝 MySQL 설정을 입력해주세요:"
read -p "사용자명 (기본값: root): " input_user
if [ -n "$input_user" ]; then
    DB_USER="$input_user"
fi

read -s -p "비밀번호 (기본값: 없음): " input_password
echo ""
if [ -n "$input_password" ]; then
    DB_PASSWORD="$input_password"
fi

read -p "호스트 (기본값: localhost): " input_host
if [ -n "$input_host" ]; then
    DB_HOST="$input_host"
fi

read -p "포트 (기본값: 3306): " input_port
if [ -n "$input_port" ]; then
    DB_PORT="$input_port"
fi

echo ""
echo "🔧 설정 정보:"
echo "  - 호스트: $DB_HOST"
echo "  - 포트: $DB_PORT"
echo "  - 사용자: $DB_USER"
echo "  - 데이터베이스: $DB_NAME"
echo ""

# MySQL 연결 테스트
echo "🔍 MySQL 연결 테스트 중..."
if [ -z "$DB_PASSWORD" ]; then
    mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -e "SELECT 1;" > /dev/null 2>&1
else
    mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" -e "SELECT 1;" > /dev/null 2>&1
fi

if [ $? -ne 0 ]; then
    echo "❌ MySQL 연결에 실패했습니다."
    echo "   1. MySQL이 설치되어 있는지 확인해주세요."
    echo "   2. MySQL 서비스가 실행 중인지 확인해주세요."
    echo "   3. 연결 정보가 올바른지 확인해주세요."
    read -p "계속하려면 Enter를 누르세요"
    exit 1
fi

echo "✅ MySQL 연결 성공!"

# 데이터베이스 생성
echo "📊 데이터베이스 생성 중..."
if [ -z "$DB_PASSWORD" ]; then
    mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -e "CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
else
    mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" -e "CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
fi

if [ $? -ne 0 ]; then
    echo "❌ 데이터베이스 생성에 실패했습니다."
    read -p "계속하려면 Enter를 누르세요"
    exit 1
fi

echo "✅ 데이터베이스 '$DB_NAME' 생성 완료!"

# 스키마 import
echo "📋 스키마 import 중..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_FILE="$SCRIPT_DIR/../sql/good_job.sql"

if [ ! -f "$SQL_FILE" ]; then
    echo "❌ SQL 파일을 찾을 수 없습니다: $SQL_FILE"
    read -p "계속하려면 Enter를 누르세요"
    exit 1
fi

if [ -z "$DB_PASSWORD" ]; then
    mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME" < "$SQL_FILE"
else
    mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < "$SQL_FILE"
fi

if [ $? -ne 0 ]; then
    echo "❌ 스키마 import에 실패했습니다."
    read -p "계속하려면 Enter를 누르세요"
    exit 1
fi

echo "✅ 스키마 import 완료!"

echo ""
echo "🎉 데이터베이스 설정이 완료되었습니다!"
echo "📊 데이터베이스: $DB_NAME"
echo "🌐 호스트: $DB_HOST:$DB_PORT"
echo ""
echo "💡 다음 단계:"
echo "   1. .env 파일에 데이터베이스 연결 정보를 설정하세요."
echo "   2. pnpm run start:dev로 애플리케이션을 실행하세요."
echo ""

read -p "계속하려면 Enter를 누르세요"

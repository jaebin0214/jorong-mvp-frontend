# 인증 API 계약서

프론트엔드는 `window.JORONG_API_BASE_URL`이 설정되면 아래 API를 호출합니다. 예: `window.JORONG_API_BASE_URL = 'https://api.example.com'`.

로컬 MVP에서는 API 주소가 없을 때에만 새로고침 시 사라지는 메모리 계정으로 동작합니다. 비밀번호는 `localStorage`에 저장하지 않습니다.

## 1. 닉네임 중복 확인 (선택)

`GET /auth/nickname-availability?nickname={nickname}`

응답 예시:

```json
{ "available": true }
```

## 2. 회원가입

`POST /auth/signup`

요청 본문:

```json
{
  "nickname": "웃긴개미_241",
  "password": "user-entered-password"
}
```

성공 응답 예시 (`201 Created`):

```json
{
  "account": {
    "id": "user_123",
    "nickname": "웃긴개미_241",
    "createdAt": "2026-08-11T10:00:00.000Z"
  }
}
```

## 3. 로그인

`POST /auth/login`

요청 본문:

```json
{
  "nickname": "웃긴개미_241",
  "password": "user-entered-password"
}
```

회원가입 보상은 없습니다. 시장 참여 크레딧은 인증 API가 아니라 거래 중 시장에 입장할 때 서버의 지갑 원장에서 처리하며, 최신 잔액은 시장 포트폴리오 응답의 `wallet.points`로 반환합니다.

성공 응답 예시 (`200 OK`):

```json
{
  "account": {
    "id": "user_123",
    "nickname": "웃긴개미_241"
  },
  "accessToken": "optional-access-token"
}
```

## 오류 응답 공통 형식

```json
{ "message": "이미 사용 중인 닉네임입니다." }
```

`400`(입력값 오류), `401`(로그인 실패), `409`(닉네임 중복)처럼 적절한 HTTP 상태 코드를 사용합니다.

## 백엔드 구현 메모

- 비밀번호 원문을 데이터베이스에 저장하지 말고 bcrypt/Argon2 등으로 salt-hash하여 저장합니다.
- HTTPS 연결에서만 인증 요청을 허용합니다.
- 닉네임 길이와 중복 여부는 프론트엔드와 무관하게 서버에서 최종 검사합니다.
- 토큰을 사용할 경우 `accessToken` 형식과 보관 방식(권장: HttpOnly Secure Cookie)을 백엔드·프론트엔드가 함께 확정합니다.

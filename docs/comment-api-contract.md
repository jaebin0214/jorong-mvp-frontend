# 댓글 API 연결 계약

프론트엔드는 `window.JORONG_API_BASE_URL`이 비어 있을 때 로컬 모의 댓글 서비스를 사용합니다. API 기본 주소를 설정하면 `POST /comments` 실제 요청으로 자동 전환됩니다.

## 요청

`POST /comments`

```json
{
  "marketSessionId": "round-001-hoon",
  "targetId": "hoon",
  "parentCommentId": null,
  "content": "이 종목은 오늘도 화제네요"
}
```

- `targetId`: 댓글을 작성하는 투자 항목 ID
- `parentCommentId`: 일반 댓글은 `null`, 답글은 부모 댓글 ID
- `content`: 1~160자 댓글 본문

작성자 정보는 인증 토큰에서 서버가 결정하는 것을 권장합니다.

## 성공 응답

```json
{
  "comment": {
    "id": "comment_123",
    "targetId": "hoon",
    "parentCommentId": null,
    "content": "이 종목은 오늘도 화제네요",
    "author": {
      "id": "user_123",
      "nickname": "웃긴개미_241"
    },
    "createdAt": "2026-08-11T10:00:00.000Z"
  }
}
```

답글도 동일한 응답 형식을 사용하며, `parentCommentId`에 부모 댓글 ID가 채워집니다.

## 오류 응답

HTTP `400` 또는 `422`에 아래 형태를 권장합니다.

```json
{ "message": "댓글 내용을 입력해주세요." }
```

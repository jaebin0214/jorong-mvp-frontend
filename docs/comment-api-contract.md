# 댓글 API 연결 계약

프론트엔드는 `window.JORONG_API_BASE_URL`이 비어 있을 때 로컬 모의 댓글 서비스를 사용합니다. API 기본 주소를 설정하면 실제 댓글 API로 자동 전환됩니다.

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

## 목록 조회

`GET /markets/{marketSessionId}/comments?targetId={targetId}`

서버는 원댓글과 답글 트리, 현재 로그인 사용자의 HYPE 선택, 베스트 댓글을 반환합니다. 삭제된 댓글은 트리 구조와 감사 기록을 보존하기 위해 제거하지 말고 `status: "DELETED"`로 반환합니다.

```json
{
  "comments": [
    {
      "id": "comment_123",
      "content": "작성자가 삭제한 댓글입니다.",
      "status": "DELETED",
      "author": { "id": "user_123", "nickname": "웃긴개미_241" },
      "replies": []
    }
  ],
  "currentUserHypedCommentId": "comment_456",
  "bestCommentId": "comment_456"
}
```

## 삭제

`DELETE /comments/{commentId}`

- 인증 필요: 예
- 서버는 댓글의 `authorId`와 현재 인증 사용자 ID가 같을 때만 삭제를 허용해야 합니다.
- 다른 사용자의 댓글·답글을 삭제하려는 요청은 `403`과 아래 오류를 반환합니다.

```json
{ "code": "COMMENT_DELETE_FORBIDDEN", "message": "본인이 작성한 댓글만 삭제할 수 있습니다." }
```

- 삭제는 소프트 삭제로 처리합니다. `status = DELETED`, `deletedAt`, `deletedBy`를 저장하고 원댓글의 다른 사용자 답글은 보존합니다.
- 관리자 목록과 감사 로그에는 삭제 상태·처리 주체가 남아야 합니다.

## 오류 응답

HTTP `400` 또는 `422`에 아래 형태를 권장합니다.

```json
{ "message": "댓글 내용을 입력해주세요." }
```

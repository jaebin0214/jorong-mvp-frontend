# 댓글 작성 종료 처리 계약

댓글과 답글 생성 API도 투자 API와 동일하게 거래 회차 종료 시점 이후 요청을 거절해야 합니다. 기존 댓글과 답글 조회는 계속 허용합니다.

## 요청 필드

`POST /comments` 요청에는 아래 값을 포함합니다.

```json
{
  "marketSessionId": "round-001-hoon",
  "targetId": "hoon",
  "parentCommentId": null,
  "content": "댓글 내용"
}
```

`parentCommentId`가 `null`이면 새 댓글, 값이 있으면 대댓글입니다.

## 종료된 회차 응답

```http
POST /comments → 409 Conflict
```

```json
{
  "code": "MARKET_CLOSED",
  "message": "거래가 종료되어 새 댓글을 작성할 수 없습니다."
}
```

서버는 `marketSessionId`의 종료 시각을 트랜잭션 안에서 확인해야 하며, 종료 후에는 댓글·대댓글 레코드를 추가하지 않아야 합니다.

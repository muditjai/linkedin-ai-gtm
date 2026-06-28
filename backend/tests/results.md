# LinkedIn AI GTM - Backend Smoke Test Report

- **Base URL:** `http://138.197.236.196`
- **Run started:** 2026-06-28 13:53:24 
- **Run finished:** 2026-06-28 13:53:25 
- **Test threads:** `thread-A`, `thread-B`
- **MongoDB:** `mongodb://localhost:27017` (local mongod)

## 1. Health

### `GET /health` - health

- **Status:** `200` (expected `200`) - **PASS**
- **Elapsed:** 49.9 ms

```json
{
  "ai": {
    "doInference": "disabled",
    "gemini": "gemini-3.1-pro"
  },
  "env": "production",
  "status": "ok",
  "success": true
}
```

## 2. /api/messages POST - happy path

### `POST /api/messages` - insert 3 msgs into thread-A

- **Status:** `200` (expected `200`) - **PASS**
- **Elapsed:** 58.0 ms

```json
{
  "counts": {
    "inserted": 0,
    "matched": 3,
    "modified": 3,
    "newSinceLastScrapeCount": 0
  },
  "success": true,
  "summary": {
    "inserted": [],
    "newSinceLastScrape": [],
    "threadUrn": "thread-A",
    "totalMessages": 3,
    "unchanged": [],
    "updated": [
      "msg-1",
      "msg-2",
      "msg-3"
    ]
  }
}
```

### `POST /api/messages` - re-upsert msg-2/3 + new msg-4

- **Status:** `200` (expected `200`) - **PASS**
- **Elapsed:** 57.2 ms

```json
{
  "counts": {
    "inserted": 0,
    "matched": 3,
    "modified": 3,
    "newSinceLastScrapeCount": 0
  },
  "success": true,
  "summary": {
    "inserted": [],
    "newSinceLastScrape": [],
    "threadUrn": "thread-A",
    "totalMessages": 3,
    "unchanged": [],
    "updated": [
      "msg-2",
      "msg-3",
      "msg-4"
    ]
  }
}
```

### `POST /api/messages` - insert 2 msgs into thread-B

- **Status:** `200` (expected `200`) - **PASS**
- **Elapsed:** 52.9 ms

```json
{
  "counts": {
    "inserted": 0,
    "matched": 2,
    "modified": 2,
    "newSinceLastScrapeCount": 0
  },
  "success": true,
  "summary": {
    "inserted": [],
    "newSinceLastScrape": [],
    "threadUrn": "thread-B",
    "totalMessages": 2,
    "unchanged": [],
    "updated": [
      "msg-1",
      "msg-2"
    ]
  }
}
```

## 3. /api/messages POST - validation errors

### `POST /api/messages` - missing threadUrn

- **Status:** `400` (expected `400`) - **PASS**
- **Elapsed:** 41.6 ms

```json
{
  "details": [
    {
      "code": "invalid_type",
      "expected": "string",
      "message": "Required",
      "path": [
        "threadUrn"
      ],
      "received": "undefined"
    }
  ],
  "error": "Invalid request body",
  "success": false
}
```

### `POST /api/messages` - empty messages array

- **Status:** `400` (expected `400`) - **PASS**
- **Elapsed:** 40.2 ms

```json
{
  "details": [
    {
      "code": "too_small",
      "exact": false,
      "inclusive": true,
      "message": "messages array must not be empty",
      "minimum": 1,
      "path": [
        "messages"
      ],
      "type": "array"
    }
  ],
  "error": "Invalid request body",
  "success": false
}
```

### `POST /api/messages` - bad direction enum

- **Status:** `400` (expected `400`) - **PASS**
- **Elapsed:** 41.9 ms

```json
{
  "details": [
    {
      "code": "invalid_enum_value",
      "message": "Invalid enum value. Expected 'inbound' | 'outbound', received 'sideways'",
      "options": [
        "inbound",
        "outbound"
      ],
      "path": [
        "messages",
        0,
        "direction"
      ],
      "received": "sideways"
    }
  ],
  "error": "Invalid request body",
  "success": false
}
```

## 4. /api/messages GET - read messages

### `GET /api/messages?threadUrn=thread-A` - list thread-A

- **Status:** `200` (expected `200`) - **PASS**
- **Elapsed:** 52.5 ms

```json
{
  "count": 4,
  "messages": [
    {
      "__v": 0,
      "_id": "6a4185316b84e782d5231bc3",
      "content": "Hey, are you free Thursday for a quick sync?",
      "conversationName": "Alice Smith",
      "conversationUrl": "https://www.linkedin.com/in/alice-smith",
      "createdAt": "2026-06-28T20:33:53.697Z",
      "dateHeading": null,
      "direction": "inbound",
      "edited": false,
      "messageUrn": "msg-1",
      "reactions": [],
      "scrapedAt": "2026-06-28T20:53:24.371Z",
      "senderName": "Alice",
      "sentAt": "2026-06-28T17:01:00.000Z",
      "threadUrn": "thread-A",
      "timestamp": "10:01 AM",
      "updatedAt": "2026-06-28T20:53:24.371Z"
    },
    {
      "__v": 0,
      "_id": "6a4185316b84e782d5231bc4",
      "content": "Yes - 2pm works.",
      "conversationName": "Alice Smith",
      "conversationUrl": "",
      "createdAt": "2026-06-28T20:33:53.697Z",
      "dateHeading": null,
      "direction": "outbound",
      "edited": false,
      "messageUrn": "msg-2",
      "reactions": [],
      "scrapedAt": "2026-06-28T20:53:24.429Z",
      "senderName": "Me",
      "sentAt": "2026-06-28T17:05:00.000Z",
      "threadUrn": "thread-A",
      "timestamp": "10:05 AM",
      "updatedAt": "2026-06-28T20:53:24.429Z"
    },
    {
      "__v": 0,
      "_id": "6a4185316b84e782d5231bc5",
      "content": "Just bring yourself.",
      "conversationName": "Alice Smith",
      "conversationUrl": "",
      "createdAt": "2026-06-28T20:33:53.697Z",
      "dateHeading": null,
      "direction": "inbound",
      "edited": false,
      "messageUrn": "msg-3",
      "reactions": [],
      "scrapedAt": "2026-06-28T20:53:24.429Z",
      "senderName": "Alice",
      "sentAt": "2026-06-28T17:07:00.000Z",
      "threadUrn": "thread-A",
      "timestamp": "10:07 AM",
      "updatedAt": "2026-06-28T20:53:24.429Z"
    },
    {
      "__v": 0,
      "_id": "6a4185316b84e782d5231bc7",
      "content": "Also, can you review my deck beforehand?",
      "conversationName": "Alice Smith",
      "conversationUrl": "",
      "createdAt": "2026-06-28T20:33:53.765Z",
      "dateHeading": null,
      "direction": "inbound",
      "edited": false,
      "messageUrn": "msg-4",
      "reactions": [],
      "scrapedAt": "2026-06-28T20:53:24.429Z",
      "senderName": "Alice",
      "sentAt": "2026-06-28T17:09:00.000Z",
      "threadUrn": "thread-A",
      "timestamp": "10:09 AM",
      "updatedAt": "2026-06-28T20:53:24.429Z"
    }
  ],
  "success": true,
  "threadUrn": "thread-A"
}
```

### `GET /api/messages?threadUrn=thread-B` - list thread-B

- **Status:** `200` (expected `200`) - **PASS**
- **Elapsed:** 43.5 ms

```json
{
  "count": 2,
  "messages": [
    {
      "__v": 0,
      "_id": "6a4185316b84e782d5231bc8",
      "content": "Saw your post - loved it.",
      "conversationName": "Bob Jones",
      "conversationUrl": "",
      "createdAt": "2026-06-28T20:33:53.824Z",
      "dateHeading": null,
      "direction": "inbound",
      "edited": false,
      "messageUrn": "msg-1",
      "reactions": [],
      "scrapedAt": "2026-06-28T20:53:24.484Z",
      "senderName": "Bob",
      "sentAt": "2026-06-28T16:00:00.000Z",
      "threadUrn": "thread-B",
      "timestamp": "9:00 AM",
      "updatedAt": "2026-06-28T20:53:24.484Z"
    },
    {
      "__v": 0,
      "_id": "6a4185316b84e782d5231bc9",
      "content": "Thanks Bob!",
      "conversationName": "Bob Jones",
      "conversationUrl": "",
      "createdAt": "2026-06-28T20:33:53.824Z",
      "dateHeading": null,
      "direction": "outbound",
      "edited": false,
      "messageUrn": "msg-2",
      "reactions": [],
      "scrapedAt": "2026-06-28T20:53:24.484Z",
      "senderName": "Me",
      "sentAt": "2026-06-28T16:30:00.000Z",
      "threadUrn": "thread-B",
      "timestamp": "9:30 AM",
      "updatedAt": "2026-06-28T20:53:24.484Z"
    }
  ],
  "success": true,
  "threadUrn": "thread-B"
}
```

### `GET /api/messages` - missing threadUrn -> 400

- **Status:** `400` (expected `400`) - **PASS**
- **Elapsed:** 40.0 ms

```json
{
  "error": "threadUrn is required",
  "success": false
}
```

### `GET /api/messages?threadUrn=does-not-exist` - unknown thread -> 200 empty

- **Status:** `200` (expected `200`) - **PASS**
- **Elapsed:** 44.5 ms

```json
{
  "count": 0,
  "messages": [],
  "success": true,
  "threadUrn": "does-not-exist"
}
```

## 5. /api/threads

### `GET /api/threads?limit=15` - list top threads (limit=15)

- **Status:** `200` (expected `200`) - **PASS**
- **Elapsed:** 44.9 ms

```json
{
  "count": 3,
  "success": true,
  "threads": [
    {
      "__v": 0,
      "_id": "6a4185316b84e782d5231bca",
      "conversationName": "Bob Jones",
      "conversationUrl": "",
      "createdAt": "2026-06-28T20:33:53.837Z",
      "inboundCount": 1,
      "lastInboundPreview": "Thanks Bob!",
      "lastMessageIsInbound": false,
      "lastMessageTime": "9:30 AM",
      "lastScrapedAt": "2026-06-28T20:53:24.484Z",
      "outboundCount": 1,
      "updatedAt": "2026-06-28T20:53:24.494Z",
      "urn": "thread-B"
    },
    {
      "__v": 0,
      "_id": "6a4185316b84e782d5231bc6",
      "conversationName": "Alice Smith",
      "conversationUrl": "",
      "createdAt": "2026-06-28T20:33:53.713Z",
      "inboundCount": 2,
      "lastInboundPreview": "Also, can you review my deck beforehand?",
      "lastMessageIsInbound": true,
      "lastMessageTime": "10:09 AM",
      "lastScrapedAt": "2026-06-28T20:53:24.429Z",
      "outboundCount": 1,
      "updatedAt": "2026-06-28T20:53:24.440Z",
      "urn": "thread-A"
    },
    {
      "__v": 0,
      "_id": "6a4185236b84e782d5231bc2",
      "conversationName": "LB Test",
      "conversationUrl": "",
      "createdAt": "2026-06-28T20:33:39.621Z",
      "inboundCount": 1,
      "lastInboundPreview": "hello from public LB",
      "lastMessageIsInbound": true,
      "lastMessageTime": "now",
      "lastScrapedAt": "2026-06-28T20:33:39.571Z",
      "outboundCount": 0,
      "updatedAt": "2026-06-28T20:33:39.621Z",
      "urn": "thread-LB-1"
    }
  ]
}
```

### `GET /api/threads?limit=1` - list top threads (limit=1)

- **Status:** `200` (expected `200`) - **PASS**
- **Elapsed:** 46.5 ms

```json
{
  "count": 1,
  "success": true,
  "threads": [
    {
      "__v": 0,
      "_id": "6a4185316b84e782d5231bca",
      "conversationName": "Bob Jones",
      "conversationUrl": "",
      "createdAt": "2026-06-28T20:33:53.837Z",
      "inboundCount": 1,
      "lastInboundPreview": "Thanks Bob!",
      "lastMessageIsInbound": false,
      "lastMessageTime": "9:30 AM",
      "lastScrapedAt": "2026-06-28T20:53:24.484Z",
      "outboundCount": 1,
      "updatedAt": "2026-06-28T20:53:24.494Z",
      "urn": "thread-B"
    }
  ]
}
```

### `GET /api/threads?limit=999` - limit clamped to 100

- **Status:** `200` (expected `200`) - **PASS**
- **Elapsed:** 44.3 ms

```json
{
  "count": 3,
  "success": true,
  "threads": [
    {
      "__v": 0,
      "_id": "6a4185316b84e782d5231bca",
      "conversationName": "Bob Jones",
      "conversationUrl": "",
      "createdAt": "2026-06-28T20:33:53.837Z",
      "inboundCount": 1,
      "lastInboundPreview": "Thanks Bob!",
      "lastMessageIsInbound": false,
      "lastMessageTime": "9:30 AM",
      "lastScrapedAt": "2026-06-28T20:53:24.484Z",
      "outboundCount": 1,
      "updatedAt": "2026-06-28T20:53:24.494Z",
      "urn": "thread-B"
    },
    {
      "__v": 0,
      "_id": "6a4185316b84e782d5231bc6",
      "conversationName": "Alice Smith",
      "conversationUrl": "",
      "createdAt": "2026-06-28T20:33:53.713Z",
      "inboundCount": 2,
      "lastInboundPreview": "Also, can you review my deck beforehand?",
      "lastMessageIsInbound": true,
      "lastMessageTime": "10:09 AM",
      "lastScrapedAt": "2026-06-28T20:53:24.429Z",
      "outboundCount": 1,
      "updatedAt": "2026-06-28T20:53:24.440Z",
      "urn": "thread-A"
    },
    {
      "__v": 0,
      "_id": "6a4185236b84e782d5231bc2",
      "conversationName": "LB Test",
      "conversationUrl": "",
      "createdAt": "2026-06-28T20:33:39.621Z",
      "inboundCount": 1,
      "lastInboundPreview": "hello from public LB",
      "lastMessageIsInbound": true,
      "lastMessageTime": "now",
      "lastScrapedAt": "2026-06-28T20:33:39.571Z",
      "outboundCount": 0,
      "updatedAt": "2026-06-28T20:33:39.621Z",
      "urn": "thread-LB-1"
    }
  ]
}
```

### `GET /api/threads/thread-A` - fetch single thread-A

- **Status:** `200` (expected `200`) - **PASS**
- **Elapsed:** 41.9 ms

```json
{
  "success": true,
  "thread": {
    "__v": 0,
    "_id": "6a4185316b84e782d5231bc6",
    "conversationName": "Alice Smith",
    "conversationUrl": "",
    "createdAt": "2026-06-28T20:33:53.713Z",
    "inboundCount": 2,
    "lastInboundPreview": "Also, can you review my deck beforehand?",
    "lastMessageIsInbound": true,
    "lastMessageTime": "10:09 AM",
    "lastScrapedAt": "2026-06-28T20:53:24.429Z",
    "outboundCount": 1,
    "updatedAt": "2026-06-28T20:53:24.440Z",
    "urn": "thread-A"
  }
}
```

### `GET /api/threads/does-not-exist` - fetch missing thread -> 404

- **Status:** `404` (expected `404`) - **PASS**
- **Elapsed:** 45.5 ms

```json
{
  "error": "thread not found",
  "success": false,
  "urn": "does-not-exist"
}
```

## 6. /api/feedback POST

### `POST /api/feedback` - submit feedback 5/5

- **Status:** `200` (expected `200`) - **PASS**
- **Elapsed:** 49.5 ms

```json
{
  "feedback": {
    "__v": 0,
    "_id": "6a4185326b84e782d5231bcb",
    "comment": "Tone matches my usual voice, good call to action.",
    "createdAt": "2026-06-28T20:33:54.429Z",
    "draft": "Happy to take a look - sending notes by EOD Thursday.",
    "messageUrn": "msg-4",
    "model": "gemini-3.1-pro",
    "score": 5,
    "sentiment": "positive",
    "threadUrn": "thread-A",
    "updatedAt": "2026-06-28T20:53:25.063Z"
  },
  "success": true
}
```

### `POST /api/feedback` - submit feedback 2/5

- **Status:** `200` (expected `200`) - **PASS**
- **Elapsed:** 49.2 ms

```json
{
  "feedback": {
    "__v": 0,
    "_id": "6a4185326b84e782d5231bcc",
    "comment": "Too short, add a concrete next step.",
    "createdAt": "2026-06-28T20:33:54.481Z",
    "draft": "Sounds good!",
    "messageUrn": "msg-3",
    "model": "gemini-3.1-pro",
    "score": 2,
    "sentiment": "positive",
    "threadUrn": "thread-A",
    "updatedAt": "2026-06-28T20:53:25.113Z"
  },
  "success": true
}
```

### `POST /api/feedback` - submit feedback 4/5 with empty messageUrn

- **Status:** `200` (expected `200`) - **PASS**
- **Elapsed:** 48.2 ms

```json
{
  "feedback": {
    "__v": 0,
    "_id": "6a4185326b84e782d5231bcd",
    "comment": "Fine but a little stiff.",
    "createdAt": "2026-06-28T20:33:54.530Z",
    "draft": "Another draft for thread-A.",
    "messageUrn": "",
    "model": "gemini-3.1-pro",
    "score": 4,
    "sentiment": "neutral",
    "threadUrn": "thread-A",
    "updatedAt": "2026-06-28T20:53:25.162Z"
  },
  "success": true
}
```

### `POST /api/feedback` - score=0 below min -> 400

- **Status:** `400` (expected `400`) - **PASS**
- **Elapsed:** 41.8 ms

```json
{
  "details": [
    {
      "code": "too_small",
      "exact": false,
      "inclusive": true,
      "message": "Number must be greater than or equal to 1",
      "minimum": 1,
      "path": [
        "score"
      ],
      "type": "number"
    }
  ],
  "error": "Invalid request body",
  "success": false
}
```

### `POST /api/feedback` - score=6 above max -> 400

- **Status:** `400` (expected `400`) - **PASS**
- **Elapsed:** 41.0 ms

```json
{
  "details": [
    {
      "code": "too_big",
      "exact": false,
      "inclusive": true,
      "maximum": 5,
      "message": "Number must be less than or equal to 5",
      "path": [
        "score"
      ],
      "type": "number"
    }
  ],
  "error": "Invalid request body",
  "success": false
}
```

### `POST /api/feedback` - missing threadUrn -> 400

- **Status:** `400` (expected `400`) - **PASS**
- **Elapsed:** 42.1 ms

```json
{
  "details": [
    {
      "code": "invalid_type",
      "expected": "string",
      "message": "Required",
      "path": [
        "threadUrn"
      ],
      "received": "undefined"
    }
  ],
  "error": "Invalid request body",
  "success": false
}
```

## 7. /api/feedback GET

### `GET /api/feedback?threadUrn=thread-A` - list feedback for thread-A

- **Status:** `200` (expected `200`) - **PASS**
- **Elapsed:** 46.1 ms

```json
{
  "count": 3,
  "feedback": [
    {
      "__v": 0,
      "_id": "6a4185326b84e782d5231bcd",
      "comment": "Fine but a little stiff.",
      "createdAt": "2026-06-28T20:33:54.530Z",
      "draft": "Another draft for thread-A.",
      "messageUrn": "",
      "model": "gemini-3.1-pro",
      "score": 4,
      "sentiment": "neutral",
      "threadUrn": "thread-A",
      "updatedAt": "2026-06-28T20:53:25.162Z"
    },
    {
      "__v": 0,
      "_id": "6a4185326b84e782d5231bcc",
      "comment": "Too short, add a concrete next step.",
      "createdAt": "2026-06-28T20:33:54.481Z",
      "draft": "Sounds good!",
      "messageUrn": "msg-3",
      "model": "gemini-3.1-pro",
      "score": 2,
      "sentiment": "positive",
      "threadUrn": "thread-A",
      "updatedAt": "2026-06-28T20:53:25.113Z"
    },
    {
      "__v": 0,
      "_id": "6a4185326b84e782d5231bcb",
      "comment": "Tone matches my usual voice, good call to action.",
      "createdAt": "2026-06-28T20:33:54.429Z",
      "draft": "Happy to take a look - sending notes by EOD Thursday.",
      "messageUrn": "msg-4",
      "model": "gemini-3.1-pro",
      "score": 5,
      "sentiment": "positive",
      "threadUrn": "thread-A",
      "updatedAt": "2026-06-28T20:53:25.063Z"
    }
  ],
  "success": true
}
```

### `GET /api/feedback` - missing threadUrn -> 400

- **Status:** `400` (expected `400`) - **PASS**
- **Elapsed:** 38.7 ms

```json
{
  "error": "threadUrn is required",
  "success": false
}
```

### `GET /api/feedback?threadUrn=does-not-exist` - unknown thread -> 200 empty

- **Status:** `200` (expected `200`) - **PASS**
- **Elapsed:** 44.1 ms

```json
{
  "count": 0,
  "feedback": [],
  "success": true
}
```

## 8. /api/draft

### `POST /api/draft` - draft reply (real Gemini call)

- **Status:** `500` (expected `200`) - **FAIL**
- **Elapsed:** 204.9 ms

```json
{
  "error": "[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro:generateContent: [404 Not Found] models/gemini-3.1-pro is not found for API version v1beta, or is not supported for generateContent. Call ModelService.ListModels to see the list of available models and their supported methods.",
  "success": false
}
```

### `POST /api/draft` - empty messages -> 400

- **Status:** `400` (expected `400`) - **PASS**
- **Elapsed:** 39.9 ms

```json
{
  "details": [
    {
      "code": "too_small",
      "exact": false,
      "inclusive": true,
      "message": "Array must contain at least 1 element(s)",
      "minimum": 1,
      "path": [
        "messages"
      ],
      "type": "array"
    }
  ],
  "error": "Invalid request body",
  "success": false
}
```

### `POST /api/draft` - missing threadUrn -> 400

- **Status:** `400` (expected `400`) - **PASS**
- **Elapsed:** 42.8 ms

```json
{
  "details": [
    {
      "code": "invalid_type",
      "expected": "string",
      "message": "Required",
      "path": [
        "threadUrn"
      ],
      "received": "undefined"
    }
  ],
  "error": "Invalid request body",
  "success": false
}
```

## 9. /api/agent (LangGraph stub)

### `POST /api/agent/decide` - POST /decide returns 501

- **Status:** `501` (expected `501`) - **PASS**
- **Elapsed:** 39.0 ms

```json
{
  "code": "AGENT_NOT_IMPLEMENTED",
  "error": "Agent backend not yet wired up. The LangGraph / DigitalOcean ADK service will be deployed separately per AGENTS.md. For now use /api/draft for AI-suggested replies.",
  "success": false
}
```

### `GET /api/agent/status` - GET /status

- **Status:** `200` (expected `200`) - **PASS**
- **Elapsed:** 39.1 ms

```json
{
  "message": "LangGraph / DO ADK agent will be deployed separately.",
  "status": "agent-backend-not-deployed",
  "success": true
}
```

## 10. 404 catch-all

### `GET /api/this-does-not-exist` - unknown route

- **Status:** `404` (expected `404`) - **PASS**
- **Elapsed:** 38.7 ms

```json
{
  "error": "Not found",
  "success": false
}
```

## Summary

| Metric | Count |
|---|---:|
| Total | 31 |
| Passed | 30 |
| Failed | 1 |

> 1 assertion(s) failed - see `raw.json` for full payloads.

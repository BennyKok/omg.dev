# Conversation identity and authorship

Status: accepted for the first vertical slice on 2026-08-20.

## Context

The current product uses `Session.botId?: string` as both runtime metadata and conversation identity. Child executions inherit that field. A bot rotation replaces the runtime. Messages have no typed author. The UI must therefore infer the product surface from a process row. This design cannot represent two bots in one conversation and can route a bot chat through a regular or child session.

## Decision

`Conversation` is the durable product object. It owns an ordered participant roster and retained runtime attachments. A participant is a verified human or a persistent bot. It has one stable ID, an access role, display metadata with an explicit fallback, and join, leave, and history-access fields. Human IDs are binding-scoped opaque digests. Bot participant IDs use the stable bot ID.

A runtime session has `conversationId`. A runtime attachment identifies the participant that it executes for and whether it is a primary or child execution. Rotation closes one attachment and adds another. It does not change the conversation ID, participants, unread key, route, or history. A child execution can attach to the conversation, but it cannot become a participant or a primary surface.

Every newly indexed product message stores a typed author reference. A verified human turn resolves only from the server-authored identity marker. A bot turn resolves only from the runtime attachment. An old or unresolvable turn stores `legacy:unknown`; the system does not infer an author from a role, name, title, or display text.

The backend contract is authoritative. API and websocket payloads carry the same `Conversation`, `ConversationParticipant`, and `MessageAuthorRef` shapes. The UI selects bot surfaces and renders participant rows from that contract. `Session.botId` stays as a deprecated compatibility field during migration.

## Migration and compatibility

The first read performs an idempotent migration. Each legacy bot conversation keeps its existing durable `sessionId` as the conversation ID. Its bot becomes a participant. Its assigned or owning human becomes a participant only when a stable identity is available. Top-level regular sessions receive a conversation with an explicit legacy source. Child sessions inherit the parent conversation attachment and never join the roster.

Old transcripts remain readable. Existing indexed rows without stored authorship become `legacy:unknown`. New rows always store an author reference. The session endpoints, deep links, pagination, optimistic messages, websocket ordering, and unread keys continue to accept the legacy session ID while clients learn `conversationId` additively.

## Scope and release order

This slice adds the model, migration, authorization helpers, runtime attachment, message author persistence, bootstrap/API delivery, routing preference, and a real multi-bot participant row. It does not add multi-bot fan-out or rewrite provider transcripts.

The legacy routing fix can land first because it only tightens `Session.botId` ownership. Rotation should land before this slice is released so its new runtime handoff can carry `conversationId`. The verified human-authorship core at `24df0d7` is integrated into this slice. The unfinished avatar and Grok-row sessions must consume the typed author and participant contracts instead of adding display-name inference.

## Consequences

Conversation state has one durable owner. Runtime identity can rotate without moving the product route. Multi-bot presentation becomes truthful. Compatibility fields remain until all consumers stop using them. The opaque human ID is a scoping and correlation mechanism. It is not anonymity because an address has low entropy and a holder of a candidate can test it.

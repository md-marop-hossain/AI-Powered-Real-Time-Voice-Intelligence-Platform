/**
 * Re-export of `ConversationLog` under the modular name `Transcript`.
 * Internally identical — kept as a thin wrapper so the public component API
 * matches the requested vocabulary (Waveform / AIAvatar / Transcript /
 * QuestionCard) without duplicating the rich animation logic that lives in
 * ConversationLog (word-by-word reveal, status pills, auto-scroll, glow line).
 */

export { ConversationLog as Transcript } from "./ConversationLog";
export type { ConversationTurn } from "./ConversationLog";

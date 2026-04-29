import { useMemo } from "react";

export type InterviewPhase =
  | "connecting"
  | "ai-asking"
  | "thinking"
  | "user-speaking"
  | "listening"
  | "ended";

export type AvatarState = "idle" | "speaking" | "thinking" | "ended";

export interface InterviewStateInput {
  connected: boolean;
  micEnabled: boolean;
  aiSpeaking: boolean;
  userSpeaking: boolean;
  aiThinking: boolean;
  ended: boolean;
}

export interface InterviewState {
  isConnected: boolean;
  isMicEnabled: boolean;
  isAISpeaking: boolean;
  isUserSpeaking: boolean;
  isThinking: boolean;
  hasEnded: boolean;
  phase: InterviewPhase;
  avatarState: AvatarState;
}

/**
 * Single source of truth for interview UI state. The InterviewRoom maintains
 * the raw booleans driven directly by WebSocket events — this hook derives
 * the orthogonal "phase" and "avatarState" used by visual components.
 *
 * The booleans are passed in (rather than owned here) so the WebSocket loop
 * stays in InterviewRoom where it can dispatch side-effects (player.flush,
 * focus-violation handling, etc.). This keeps the hook pure.
 */
export function useInterviewState(input: InterviewStateInput): InterviewState {
  return useMemo(() => {
    const phase: InterviewPhase = input.ended
      ? "ended"
      : !input.connected
        ? "connecting"
        : input.aiSpeaking
          ? "ai-asking"
          : input.aiThinking
            ? "thinking"
            : input.userSpeaking
              ? "user-speaking"
              : "listening";

    const avatarState: AvatarState = input.ended
      ? "ended"
      : input.aiSpeaking
        ? "speaking"
        : input.aiThinking
          ? "thinking"
          : "idle";

    return {
      isConnected: input.connected,
      isMicEnabled: input.micEnabled,
      isAISpeaking: input.aiSpeaking,
      isUserSpeaking: input.userSpeaking,
      isThinking: input.aiThinking,
      hasEnded: input.ended,
      phase,
      avatarState,
    };
  }, [
    input.connected,
    input.micEnabled,
    input.aiSpeaking,
    input.userSpeaking,
    input.aiThinking,
    input.ended,
  ]);
}

import { create } from "zustand";

/**
 * Which Home workspace is showing. UI-only navigation state: conversation is
 * the default main surface; image / video / scheduled are reached from the
 * sidebar navigation (they used to be a tab strip floating at the top of Home).
 */
export type HomeWorkspaceMode = "conversation" | "image" | "video" | "automations";

interface HomeWorkspaceState {
  mode: HomeWorkspaceMode;
  setMode(mode: HomeWorkspaceMode): void;
}

export const useHomeWorkspace = create<HomeWorkspaceState>((set) => ({
  mode: "conversation",
  setMode(mode) {
    set({ mode });
  },
}));

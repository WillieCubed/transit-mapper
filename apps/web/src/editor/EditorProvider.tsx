import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { useStore } from "zustand";
import { createEditorStore, type EditorState, type EditorStore } from "./store";

// The editor store is created once and shared through context, so React
// components consume it via hooks and the imperative map/keyboard layers
// receive the same instance by injection — no module-level singleton.
const EditorStoreContext = createContext<EditorStore | null>(null);

interface EditorProviderProps {
  children: ReactNode;
}

export function EditorProvider({ children }: EditorProviderProps) {
  const storeRef = useRef<EditorStore | null>(null);
  if (storeRef.current === null) storeRef.current = createEditorStore();

  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as unknown as { __editor?: unknown }).__editor = storeRef.current;
    }
  }, []);

  return <EditorStoreContext.Provider value={storeRef.current}>{children}</EditorStoreContext.Provider>;
}

/** The store instance, for imperative access (getState / subscribe / actions). */
export function useEditorStore(): EditorStore {
  const store = useContext(EditorStoreContext);
  if (!store) throw new Error("useEditorStore must be used within <EditorProvider>");
  return store;
}

/** Subscribe to a slice of editor state. */
export function useEditor<T>(selector: (s: EditorState) => T): T {
  return useStore(useEditorStore(), selector);
}

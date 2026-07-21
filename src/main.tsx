import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { EditorProvider } from "./editor/EditorProvider";
import { UiProvider } from "./ui/UiProvider";
import { ViewProvider } from "./ui/ViewProvider";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <EditorProvider>
      <UiProvider>
        <ViewProvider>
          <App />
        </ViewProvider>
      </UiProvider>
    </EditorProvider>
  </StrictMode>,
);

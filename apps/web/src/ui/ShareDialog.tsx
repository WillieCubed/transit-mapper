import { useEffect, useState } from "react";
import { useEditor } from "../editor/EditorProvider";
import { createShare } from "../share/api";
import { Icon } from "./Icon";
import { Modal } from "./Modal";

interface ShareDialogProps {
  onClose: () => void;
}

export function ShareDialog({ onClose }: ShareDialogProps) {
  const system = useEditor((s) => s.system);
  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    createShare(system)
      .then((id) => {
        if (cancelled) return;
        setUrl(`${window.location.origin}/s/${id}`);
        setStatus("done");
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
    // Snapshot is taken once when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked — the field is selectable as a fallback
    }
  };

  return (
    <Modal title="Share this system" description="Create a shareable, read-only link to this system." onClose={onClose}>
      {status === "loading" && <p className="panel-hint">Creating a shareable snapshot…</p>}

      {status === "error" && (
        <p className="error-text">Couldn’t create the link. {error}</p>
      )}

      {status === "done" && (
        <>
          <p className="panel-hint">
            Anyone with this link can view the system and fork their own copy.
          </p>
          <div className="share-row">
            <input className="share-url" value={url} readOnly onFocus={(e) => e.target.select()} />
            <button className="primary-btn" onClick={copy}>
              <Icon name="copy" size={18} /> {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

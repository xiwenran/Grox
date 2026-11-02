import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../lib/i18n";
import { Icon } from "../fx/Icon";

/** Full-window image preview. Esc, the backdrop or the close button dismiss it. */
export function ImageLightbox({ src, alt, onClose }: { src: string; alt?: string; onClose: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={t("imagePreview")} onClick={onClose} className="image-lightbox fixed inset-0 z-[90] flex cursor-zoom-out items-center justify-center p-10 animate-fade-up">
      <button type="button" onClick={onClose} className="image-lightbox__close absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full text-dim hover:text-fg" title={t("closeImagePreview")}>
        <Icon name="x" size={13} />
      </button>
      <img src={src} alt={alt ?? ""} className="image-lightbox__img max-h-full max-w-full object-contain" />
      {alt ? <div className="image-lightbox__caption pointer-events-none absolute inset-x-0 bottom-4 text-center text-[13px] text-mute">{alt}</div> : null}
    </div>,
    document.body,
  );
}

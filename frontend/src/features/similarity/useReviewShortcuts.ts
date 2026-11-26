import { useEffect } from "react";
import type { SimilarityReview } from "./useSimilarityReview";

export function useReviewShortcuts(
  review: SimilarityReview,
  enabled: boolean,
  returnToList: () => void,
) {
  useEffect(() => {
    if (!enabled) return;
    function keydown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        event.altKey
      )
        return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest(
          "input,textarea,select,[contenteditable=true],[role=menu],[role=listbox]",
        )
      )
        return;
      if (!target?.closest("[data-review-stage],[data-review-layout]")) return;
      const modal = Array.from(
        document.querySelectorAll("dialog[open],[aria-modal=true]"),
      ).at(-1);
      if (
        modal &&
        (!modal.contains(target) || !modal.querySelector("[data-review-stage]"))
      )
        return;
      const key = event.key.toLowerCase();
      if (event.ctrlKey || event.metaKey) {
        if (`ctrl+${key}` !== "ctrl+z" || event.shiftKey) return;
        event.preventDefault();
        void review.undo();
        return;
      }
      if (event.shiftKey) return;
      if (key === "j" || key === "arrowdown") review.next();
      else if (key === "k" || key === "arrowup") review.prev();
      else if (key === "arrowleft") review.focusMember(-1);
      else if (key === "arrowright") review.focusMember(1);
      else if (/^[1-9]$/.test(key))
        void review.setRepresentative(Number(key) - 1);
      else if (key === "enter" && target?.closest("button,a")) return;
      else if (key === "e" || key === "enter") void review.markReviewed();
      else if (key === "x") void review.ignore();
      else if (key === "p") void review.addPick();
      else if (key === " " && review.active)
        review.toggleChecked(review.active.id);
      else if (key === "escape") {
        if (review.state.checked.size) review.clearChecked();
        else if (!modal) returnToList();
        else return;
      } else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [review, enabled, returnToList]);
}

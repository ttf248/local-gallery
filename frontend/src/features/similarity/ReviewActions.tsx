import { Kbd } from "../../ui/Kbd";
import { Button } from "../../ui/Button";
import type { SimilarityReview } from "./useSimilarityReview";
export function ReviewActions({ review }: { review: SimilarityReview }) {
  const busy = Boolean(
    review.active && review.state.pending.has(review.active.id),
  );
  return (
    <div
      role="group"
      aria-label="审阅操作"
      className="flex flex-wrap justify-end gap-2 border-t border-line-subtle pt-4"
    >
      <Button
        variant="secondary"
        disabled={busy}
        onClick={() => void review.setRepresentative(review.state.focusIndex)}
      >
        设为代表 <Kbd keys={["1–9"]} />
      </Button>
      <Button
        variant="secondary"
        disabled={busy}
        onClick={() => void review.addPick()}
      >
        加入精选 <Kbd keys={["P"]} />
      </Button>
      <Button
        variant="ghost"
        disabled={busy}
        onClick={() => void review.ignore()}
      >
        忽略 <Kbd keys={["X"]} />
      </Button>
      <Button
        variant="secondary"
        className="font-bold"
        loading={busy}
        onClick={() => void review.markReviewed()}
      >
        标记已处理 <Kbd keys={["↵"]} />
      </Button>
    </div>
  );
}

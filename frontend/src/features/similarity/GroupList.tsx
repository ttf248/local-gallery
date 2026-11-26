import { useEffect, useRef } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type { SimilarityReview } from "./useSimilarityReview";
import { GroupListRow } from "./GroupListRow";

export function GroupList({ review }: { review: SimilarityReview }) {
  const { groups, activeId, checked } = review.state;
  const list = useRef<VirtuosoHandle>(null);
  const index = groups.findIndex((group) => group.id === activeId);
  useEffect(() => {
    if (index >= 0) list.current?.scrollIntoView({ index });
  }, [index]);
  return (
    <Virtuoso
      ref={list}
      aria-label="相似组列表"
      className="h-full"
      data={groups}
      fixedItemHeight={72}
      computeItemKey={(_, group) => group.id}
      endReached={() => {
        if (!review.source.isFetchNextPageError) review.loadMore();
      }}
      itemContent={(_, group) => (
        <GroupListRow
          group={group}
          active={group.id === activeId}
          checked={checked.has(group.id)}
          onSelect={() => review.select(group.id)}
          onCheck={(range) => review.toggleChecked(group.id, range)}
        />
      )}
    />
  );
}

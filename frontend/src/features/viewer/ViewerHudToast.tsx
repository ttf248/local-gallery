import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { aiJobsApi } from "../../api/aiJobs";

export function ViewerHudToast({
  value,
}: {
  value: { message: string } | null;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!value) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 900);
    return () => clearTimeout(timer);
  }, [value]);
  return (
    <div
      role="status"
      data-testid="viewer-hud"
      className={`pointer-events-none fixed bottom-8 left-1/2 z-40 -translate-x-1/2 rounded-full border border-theater-border bg-theater-surface/90 px-3.5 py-1.5 text-caption font-medium text-theater-fg shadow-2 backdrop-blur-md motion-safe:transition-opacity ${visible ? "opacity-100 duration-[140ms]" : "opacity-0 duration-[220ms]"}`}
    >
      {visible ? value?.message : ""}
    </div>
  );
}
export function ViewerExifSummary({ id }: { id: string }) {
  const { data } = useQuery({
    queryKey: ["image-exif", id],
    queryFn: () => aiJobsApi.metadata(id),
    staleTime: 60000,
  });
  const m = data?.metadata;
  if (!m) return null;
  const exposure = m.exposureSeconds;
  const text = [
    ...new Set([m.cameraMake, m.cameraModel].filter(Boolean)),
    m.focalLength && Number(m.focalLength.toFixed(1)) + "mm",
    m.aperture && "f/" + Number(m.aperture.toFixed(1)),
    exposure &&
      (exposure < 1
        ? "1/" + Math.round(1 / exposure)
        : Number(exposure.toFixed(1))) + "s",
    m.iso && "ISO " + m.iso,
  ]
    .filter(Boolean)
    .join(" · ");
  return text ? (
    <p className="pointer-events-none absolute bottom-2 left-3 z-10 max-w-full truncate rounded bg-theater-scrim/80 px-2 py-1 font-mono text-caption text-theater-fg">
      {text}
    </p>
  ) : null;
}

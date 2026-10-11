export function Skeleton({ width = '100%', height = 16, radius = 8, style }) {
  return <div className="skeleton" style={{ width, height, borderRadius: radius, ...style }} />;
}

export function SkeletonCard() {
  return (
    <div className="card card-pad flex-col gap-2">
      <div className="flex justify-between items-center">
        <Skeleton width={36} height={36} radius={10} />
        <Skeleton width={50} height={20} radius={999} />
      </div>
      <Skeleton width="80%" height={16} />
      <Skeleton width="100%" height={12} />
      <Skeleton width="60%" height={12} />
    </div>
  );
}

export function SkeletonGrid({ count = 6 }) {
  return (
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
      {Array.from({ length: count }).map((_, i) => <SkeletonCard key={i} />)}
    </div>
  );
}

export function SkeletonRow() {
  return (
    <div className="card card-pad flex items-center justify-between">
      <div className="flex items-center gap-2" style={{ flex: 1 }}>
        <Skeleton width={36} height={36} radius={10} />
        <div className="flex-col gap-1" style={{ flex: 1 }}>
          <Skeleton width="40%" height={14} />
          <Skeleton width="25%" height={11} />
        </div>
      </div>
      <Skeleton width={80} height={26} radius={999} />
    </div>
  );
}

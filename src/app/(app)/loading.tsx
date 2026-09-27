export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-3 w-40 animate-pulse rounded bg-muted-strong" />
      <div className="h-10 w-72 max-w-full animate-pulse rounded-md bg-muted-strong" />
      <div className="h-4 w-96 max-w-full animate-pulse rounded bg-muted" />
      <div className="grid grid-cols-1 gap-4 pt-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-44 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    </div>
  );
}

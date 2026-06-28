import React from 'react'

const SkeletonLine = ({ className = '' }) => (
  <div className={`animate-pulse rounded-full bg-slate-200 ${className}`} />
)

const AppBootShell = () => {
  return (
    <div className="h-screen overflow-hidden bg-slate-50">
      <div className="flex h-full flex-col md:flex-row">
        <aside className="hidden h-screen w-60 shrink-0 border-r border-slate-200 bg-white p-4 md:block">
          <div className="mb-6 flex items-center gap-3">
            <div className="h-10 w-10 animate-pulse rounded-lg bg-slate-200" />
            <div className="min-w-0 flex-1">
              <SkeletonLine className="mb-2 h-3 w-28" />
              <SkeletonLine className="h-2.5 w-20" />
            </div>
          </div>

          <div className="space-y-3">
            {[0, 1, 2, 3, 4, 5, 6].map((item) => (
              <div key={item} className="flex items-center gap-3 rounded-lg px-2 py-2">
                <div className="h-8 w-8 animate-pulse rounded-lg bg-slate-200" />
                <SkeletonLine className="h-3 w-28" />
              </div>
            ))}
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-hidden">
          <div className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 md:hidden">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 animate-pulse rounded-lg bg-slate-200" />
              <SkeletonLine className="h-3 w-32" />
            </div>
            <div className="h-9 w-9 animate-pulse rounded-full bg-slate-200" />
          </div>

          <div className="h-full overflow-y-auto p-4 md:p-6">
            <div className="mx-auto max-w-7xl">
              <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <SkeletonLine className="mb-3 h-4 w-44" />
                  <SkeletonLine className="h-3 w-64 max-w-full" />
                </div>
                <div className="inline-flex items-center gap-2 self-start rounded-full border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  <span>Memuat dashboard...</span>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {[0, 1, 2, 3].map((item) => (
                  <div key={item} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-5 flex items-center justify-between">
                      <SkeletonLine className="h-3 w-20" />
                      <div className="h-9 w-9 animate-pulse rounded-lg bg-slate-200" />
                    </div>
                    <SkeletonLine className="mb-3 h-6 w-24" />
                    <SkeletonLine className="h-2.5 w-32" />
                  </div>
                ))}
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <SkeletonLine className="mb-5 h-4 w-36" />
                  <div className="space-y-3">
                    {[0, 1, 2, 3, 4].map((item) => (
                      <div key={item} className="flex items-center gap-3">
                        <div className="h-10 w-10 animate-pulse rounded-lg bg-slate-200" />
                        <div className="flex-1">
                          <SkeletonLine className="mb-2 h-3 w-3/4" />
                          <SkeletonLine className="h-2.5 w-1/2" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <SkeletonLine className="mb-5 h-4 w-32" />
                  <div className="space-y-4">
                    <SkeletonLine className="h-24 w-full rounded-lg" />
                    <SkeletonLine className="h-3 w-4/5" />
                    <SkeletonLine className="h-3 w-2/3" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

export default AppBootShell

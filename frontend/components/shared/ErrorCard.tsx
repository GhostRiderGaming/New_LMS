'use client'

interface Props {
  message: string
  onRetry?: () => void
}

export default function ErrorCard({ message, onRetry }: Props) {
  return (
    <div className="card-game border-red-500/30 p-4">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center text-red-400 text-sm shrink-0">✗</div>
        <div className="flex-1">
          <p className="text-sm text-red-300 leading-relaxed">{message}</p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="mt-3 px-4 py-1.5 rounded-lg bg-red-500/10 text-red-300 hover:bg-red-500/20 text-xs font-medium transition-all border border-red-500/20"
            >
              🔄 Retry
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

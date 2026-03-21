interface Props {
  message: string
  onRetry?: () => void
}

export default function ErrorCard({ message, onRetry }: Props) {
  return (
    <div className="w-full bg-red-950/30 border border-red-500/30 rounded-xl p-5 flex items-start gap-4">
      <div className="w-8 h-8 rounded-lg bg-red-500/20 flex items-center justify-center text-red-400 shrink-0">
        ✗
      </div>
      <div className="flex-1">
        <p className="text-red-400 font-medium text-sm mb-1">Generation Failed</p>
        <p className="text-slate-400 text-xs">{message}</p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-4 py-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 text-xs font-medium transition-colors"
        >
          Retry
        </button>
      )}
    </div>
  )
}

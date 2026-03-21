'use client'
import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import TopicInput from '@/components/shared/TopicInput'
import JobProgressBar from '@/components/shared/JobProgressBar'
import ErrorCard from '@/components/shared/ErrorCard'
import SimulationFrame from '@/components/simulation/SimulationFrame'

const categories = ['physics', 'chemistry', 'biology', 'mathematics', 'history'] as const
type Category = typeof categories[number]

const categoryIcons: Record<Category, string> = {
  physics: '⚛️',
  chemistry: '🧪',
  biology: '🌱',
  mathematics: '📐',
  history: '🏛️',
}

export default function SimulationPage() {
  const searchParams = useSearchParams()
  const [topic, setTopic] = useState(searchParams.get('topic') || '')
  const [category, setCategory] = useState<Category>('physics')
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<'queued' | 'processing' | 'complete' | 'failed' | null>(null)
  const [simulationHtml, setSimulationHtml] = useState<string | null>(null)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleGenerate = async (t: string) => {
    setTopic(t)
    setError(null)
    setJobId(null)
    setJobStatus(null)
    setSimulationHtml(null)
    setLoading(true)
    try {
      await new Promise((r) => setTimeout(r, 500))
      const fakeJobId = crypto.randomUUID()
      setJobId(fakeJobId)
      setJobStatus('queued')
      setTimeout(() => setJobStatus('processing'), 1500)
      setTimeout(() => {
        setJobStatus('complete')
        // Placeholder simulation HTML
        setSimulationHtml(`<!DOCTYPE html><html><head><style>
          body{margin:0;background:#0a0a0f;color:#f1f5f9;font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:16px;}
          h2{color:#7c3aed;margin:0;}canvas{border:1px solid #1e1e3a;border-radius:12px;}
          .controls{display:flex;gap:12px;align-items:center;}
          input[type=range]{accent-color:#7c3aed;}label{font-size:12px;color:#94a3b8;}
        </style></head><body>
          <h2>${t} — ${category} Simulation</h2>
          <canvas id="c" width="480" height="300"></canvas>
          <div class="controls"><label>Speed <input type="range" id="spd" min="1" max="10" value="5"></label></div>
          <script>
            const c=document.getElementById('c'),ctx=c.getContext('2d');
            let t=0,spd=5;
            document.getElementById('spd').oninput=e=>spd=+e.target.value;
            function draw(){
              ctx.fillStyle='#0a0a0f';ctx.fillRect(0,0,480,300);
              ctx.strokeStyle='#7c3aed';ctx.lineWidth=2;ctx.beginPath();
              for(let x=0;x<480;x++){const y=150+80*Math.sin((x+t)*0.02*spd);x===0?ctx.moveTo(x,y):ctx.lineTo(x,y);}
              ctx.stroke();t+=1;requestAnimationFrame(draw);
            }draw();
          </script></body></html>`)
        setShareUrl(`${window.location.origin}/simulation?id=${fakeJobId}`)
        setLoading(false)
      }, 6000)
    } catch {
      setError('Failed to generate simulation. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-accent-cyan/20 flex items-center justify-center text-xl">🔬</div>
          <div>
            <h1 className="text-2xl font-bold text-white">Simulation Engine</h1>
            <p className="text-slate-400 text-sm">Generate interactive browser-based educational simulations</p>
          </div>
        </div>
      </div>

      <div className="mb-6">
        <TopicInput onSubmit={handleGenerate} loading={loading} defaultValue={topic} buttonLabel="Generate Simulation">
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all capitalize ${
                  category === c
                    ? 'bg-accent-cyan text-bg-primary font-semibold'
                    : 'bg-bg-elevated text-slate-400 hover:text-white border border-border'
                }`}
              >
                {categoryIcons[c]} {c}
              </button>
            ))}
          </div>
        </TopicInput>
      </div>

      {jobId && jobStatus !== 'complete' && jobStatus !== 'failed' && (
        <div className="mb-6">
          <JobProgressBar jobId={jobId} status={jobStatus} label="Generating simulation code..." />
        </div>
      )}

      {error && (
        <div className="mb-6">
          <ErrorCard message={error} onRetry={() => topic && handleGenerate(topic)} />
        </div>
      )}

      {simulationHtml && (
        <SimulationFrame html={simulationHtml} topic={topic} shareUrl={shareUrl || undefined} />
      )}

      {!simulationHtml && !loading && !jobId && (
        <div className="text-center py-20 text-slate-600">
          <div className="text-5xl mb-4">🔬</div>
          <p className="text-sm">Enter a topic to generate an interactive simulation</p>
        </div>
      )}
    </div>
  )
}

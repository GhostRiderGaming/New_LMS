'use client'
import { useState } from 'react'
import TopicInput from '@/components/shared/TopicInput'
import JobProgressBar from '@/components/shared/JobProgressBar'
import ErrorCard from '@/components/shared/ErrorCard'
import ModelViewer3D from '@/components/model3d/ModelViewer3D'

const categories = ['anatomy', 'chemistry', 'astronomy', 'historical', 'mechanical'] as const
type Category = typeof categories[number]

const categoryIcons: Record<Category, string> = {
  anatomy: '🫀',
  chemistry: '⚗️',
  astronomy: '🪐',
  historical: '🏺',
  mechanical: '⚙️',
}

const categoryExamples: Record<Category, string> = {
  anatomy: 'human heart, brain, lungs',
  chemistry: 'water molecule, DNA helix',
  astronomy: 'solar system, black hole',
  historical: 'Roman helmet, Egyptian vase',
  mechanical: 'gear assembly, engine piston',
}

export default function Model3DPage() {
  const [category, setCategory] = useState<Category>('anatomy')
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<'queued' | 'processing' | 'complete' | 'failed' | null>(null)
  const [modelUrl, setModelUrl] = useState<string | null>(null)
  const [modelMeta, setModelMeta] = useState<{ name: string; description: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [objectName, setObjectName] = useState('')

  const handleGenerate = async (name: string) => {
    setObjectName(name)
    setError(null)
    setJobId(null)
    setJobStatus(null)
    setModelUrl(null)
    setLoading(true)
    try {
      await new Promise((r) => setTimeout(r, 500))
      const fakeJobId = crypto.randomUUID()
      setJobId(fakeJobId)
      setJobStatus('queued')
      setTimeout(() => setJobStatus('processing'), 1500)
      setTimeout(() => {
        setJobStatus('complete')
        // Placeholder — real impl uses actual GLTF from Fal.ai
        setModelUrl(null)
        setModelMeta({
          name,
          description: `A detailed 3D model of a ${name} in the ${category} category. Scale reference: approximately life-size.`,
        })
        setLoading(false)
      }, 7000)
    } catch {
      setError('Failed to generate 3D model. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-accent-pink/20 flex items-center justify-center text-xl">🧊</div>
          <div>
            <h1 className="text-2xl font-bold text-white">3D Model Generator</h1>
            <p className="text-slate-400 text-sm">Generate interactive 3D models of real-world objects</p>
          </div>
        </div>
      </div>

      <div className="mb-6">
        <TopicInput
          onSubmit={handleGenerate}
          loading={loading}
          placeholder={`Enter an object name — e.g. ${categoryExamples[category]}...`}
          buttonLabel="Generate 3D Model"
        >
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all capitalize ${
                  category === c
                    ? 'bg-accent-pink text-white shadow-glow-pink'
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
          <JobProgressBar jobId={jobId} status={jobStatus} label="Generating 3D model with Hunyuan3D-2.1..." />
        </div>
      )}

      {error && (
        <div className="mb-6">
          <ErrorCard message={error} onRetry={() => objectName && handleGenerate(objectName)} />
        </div>
      )}

      {(modelUrl || modelMeta) && (
        <ModelViewer3D gltfUrl={modelUrl} metadata={modelMeta} />
      )}

      {!modelUrl && !modelMeta && !loading && !jobId && (
        <div className="text-center py-20 text-slate-600">
          <div className="text-5xl mb-4">🧊</div>
          <p className="text-sm">Enter an object name to generate a 3D model</p>
          <p className="text-xs mt-2 text-slate-700">Try: human heart, water molecule, Saturn, Roman helmet</p>
        </div>
      )}
    </div>
  )
}

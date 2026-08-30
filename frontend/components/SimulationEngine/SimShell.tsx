import React, { useState, useEffect, useRef } from 'react';
import './SimShell.css';

export interface ExtractedControl {
  id: string;
  type: string;
  min?: number;
  max?: number;
  step?: number;
  value: any;
  label: string;
}

interface SimShellProps {
  concept: string;
  simulationCode: string | null;
  onRegenerate: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onIframeLoad?: () => void;
  onIframeError?: () => void;
}

export default function SimShell({ concept, simulationCode, onRegenerate, fullscreen, onToggleFullscreen, onIframeLoad, onIframeError }: SimShellProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [controls, setControls] = useState<ExtractedControl[]>([]);
  const [playing, setPlaying] = useState(true);
  const [showWiggle, setShowWiggle] = useState(true);

  // Auto-Bridge Injector
  useEffect(() => {
    if (!simulationCode || !iframeRef.current) return;
    
    // Inject the Auto-Bridge script right before </body>
    const bridgeScript = `
      <script>
        window.addEventListener('DOMContentLoaded', () => {
          const controls = [];
          document.querySelectorAll('input[type=range], input[type=checkbox]').forEach(el => {
            if (!el.id) el.id = 'ctrl_' + Math.random().toString(36).substr(2, 9);
            let label = el.id;
            if (el.parentElement && el.parentElement.tagName === 'LABEL') {
              label = el.parentElement.innerText.replace(el.value, '').trim();
              if (label.endsWith(':')) label = label.slice(0, -1);
            }
            controls.push({
              id: el.id,
              type: el.type,
              min: el.min || 0,
              max: el.max || 100,
              step: el.step || 1,
              value: el.type === 'checkbox' ? el.checked : el.value,
              label
            });
            // hide original
            if (el.parentElement && el.parentElement.tagName === 'LABEL') {
              el.parentElement.style.display = 'none';
            } else {
              el.style.display = 'none';
            }
          });
          
          // Hide any remaining ugly text blocks in the control panel region if they exist
          document.querySelectorAll('.controls, #controls').forEach(el => el.style.display = 'none');

          window.parent.postMessage({ type: 'REGISTER_CONTROLS', controls }, '*');
          
          // Listen for interaction to dismiss wiggle
          document.addEventListener('mousedown', () => {
             window.parent.postMessage({ type: 'INTERACTION_STARTED' }, '*');
          });
        });

        window.addEventListener('message', (e) => {
          if (e.data.type === 'SET_CONTROL') {
            const el = document.getElementById(e.data.id);
            if (el) {
              if (el.type === 'checkbox') el.checked = e.data.value;
              else el.value = e.data.value;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
          if (e.data.type === 'RESET' && window.simAPI && window.simAPI.reset) window.simAPI.reset();
          if (e.data.type === 'TOGGLE_PLAY' && window.simAPI) {
            if (e.data.playing && window.simAPI.play) window.simAPI.play();
            if (!e.data.playing && window.simAPI.pause) window.simAPI.pause();
          }
        });
      </script>
    </body>`;
    
    // Fallback if no </body> is present (shouldn't happen with well-formed HTML)
    const injectedHTML = simulationCode.includes('</body>') 
      ? simulationCode.replace('</body>', bridgeScript)
      : simulationCode + bridgeScript;
      
    const blob = new Blob([injectedHTML], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    iframeRef.current.src = url;

    return () => {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setControls([]);
      setPlaying(true);
      setShowWiggle(true);
    };
  }, [simulationCode]);

  // Handle postMessage from iframe
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data.type === 'REGISTER_CONTROLS') {
        setControls(e.data.controls);
      } else if (e.data.type === 'INTERACTION_STARTED') {
        setShowWiggle(false);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleControlChange = (id: string, value: any) => {
    setControls(prev => prev.map(c => c.id === id ? { ...c, value } : c));
    iframeRef.current?.contentWindow?.postMessage({ type: 'SET_CONTROL', id, value }, '*');
  };

  const handleReset = () => {
    iframeRef.current?.contentWindow?.postMessage({ type: 'RESET' }, '*');
    setPlaying(true);
  };

  const handleTogglePlay = () => {
    const newPlaying = !playing;
    setPlaying(newPlaying);
    iframeRef.current?.contentWindow?.postMessage({ type: 'TOGGLE_PLAY', playing: newPlaying }, '*');
  };

  return (
    <div 
      className={`sim-shell ${fullscreen ? 'sim-shell--fullscreen' : ''}`}
      style={{ height: fullscreen ? '100vh' : '560px' }}
    >
      <div className="sim-shell__play-area">
        <iframe
          ref={iframeRef}
          className="sim-shell__iframe"
          sandbox="allow-scripts"
          title="Interactive Simulation"
          onLoad={onIframeLoad}
          onError={onIframeError}
        />
        {showWiggle && simulationCode && (
          <div className="sim-shell__wiggle-hint">
            <span className="sim-shell__wiggle-arrow">↖</span> Drag me!
          </div>
        )}
      </div>

      {simulationCode && (
        <div className="sim-shell__control-panel">
          <div className="sim-shell__control-header">
            <h3 className="sim-shell__title" title={concept}>{concept}</h3>
            <div className="sim-shell__header-actions">
              <button className="sim-shell__icon-btn" onClick={onRegenerate} title="Regenerate">↻</button>
              <button className="sim-shell__icon-btn" onClick={onToggleFullscreen} title="Fullscreen">⊞</button>
            </div>
          </div>

          <div className="sim-shell__controls-list">
            {controls.length === 0 ? (
              <div className="sim-shell__no-controls">No adjustable controls</div>
            ) : (
              controls.map(c => (
                <div key={c.id} className="sim-shell__control-item">
                  <div className="sim-shell__control-label-row">
                    <label>{c.label}</label>
                    {c.type === 'range' && <span className="sim-shell__control-val">{Number(c.value).toFixed(2).replace(/\.00$/, '')}</span>}
                  </div>
                  {c.type === 'range' ? (
                    <input
                      type="range"
                      min={c.min}
                      max={c.max}
                      step={c.step}
                      value={c.value}
                      onChange={(e) => handleControlChange(c.id, e.target.value)}
                      className="sim-shell__slider"
                    />
                  ) : (
                    <input
                      type="checkbox"
                      checked={c.value}
                      onChange={(e) => handleControlChange(c.id, e.target.checked)}
                      className="sim-shell__checkbox"
                    />
                  )}
                </div>
              ))
            )}
          </div>

          <div className="sim-shell__playback">
            <button className={`sim-shell__play-btn ${playing ? 'playing' : ''}`} onClick={handleTogglePlay}>
              {playing ? '⏸ Pause' : '▶ Play'}
            </button>
            <button className="sim-shell__reset-btn" onClick={handleReset}>
              <span className="sim-shell__reset-icon">↺</span> Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

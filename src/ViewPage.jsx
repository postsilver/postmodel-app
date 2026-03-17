import { useState, useEffect, Suspense } from 'react'
import { useParams } from 'react-router-dom'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import { Scene } from './App.jsx'

export default function ViewPage() {
  const { id } = useParams()
  const [placedFurniture, setPlacedFurniture] = useState(null)
  const [envIntensity, setEnvIntensity] = useState(0.09)
  const [pointLightIntensity, setPointLightIntensity] = useState(1.0)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch(`/api/scene/${id}`)
      .then(res => {
        if (!res.ok) throw new Error('not found')
        return res.json()
      })
      .then(data => {
        const raw = data.scene
        if (Array.isArray(raw)) {
          setPlacedFurniture(raw)
        } else {
          setPlacedFurniture(raw.furniture ?? [])
          if (raw.lighting) {
            if (raw.lighting.envIntensity != null) setEnvIntensity(raw.lighting.envIntensity)
            if (raw.lighting.pointLightIntensity != null) setPointLightIntensity(raw.lighting.pointLightIntensity)
          }
        }
      })
      .catch(() => setError(true))
  }, [id])

  const centerStyle = {
    width: '100vw',
    height: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column',
    gap: '12px',
    background: '#1a1a1a',
    color: '#888',
    fontFamily: 'Arial, sans-serif',
  }

  if (error) return (
    <div style={centerStyle}>
      <div style={{ fontSize: '48px', color: '#444' }}>404</div>
      <div>Scene not found or link has expired</div>
    </div>
  )

  if (!placedFurniture) return (
    <div style={centerStyle}>
      <div>Loading scene...</div>
    </div>
  )

  return (
    <Canvas
      shadows
      camera={{ position: [5, 5, 5], fov: 50 }}
      style={{ width: '100vw', height: '100vh' }}
      gl={{
        antialias: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 0.5,
      }}
    >
      <Suspense fallback={null}>
        <Scene
          placedFurniture={placedFurniture}
          selectedId={null}
          setSelectedId={() => {}}
          isDragging={false}
          setIsDragging={() => {}}
          onMeshListUpdate={() => {}}
          onUpdatePosition={() => {}}
          isEmbed={true}
          envIntensity={envIntensity}
          pointLightIntensity={pointLightIntensity}
        />
      </Suspense>
    </Canvas>
  )
}

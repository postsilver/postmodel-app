import { useRef, useState, useMemo, Suspense, useEffect, memo } from 'react'
import { Canvas, useFrame, useThree, extend } from '@react-three/fiber'
import { OrbitControls, PointerLockControls, useGLTF, Environment, Html } from '@react-three/drei'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { useDrag } from '@use-gesture/react'
import * as THREE from 'three/webgpu'
import { upload } from '@vercel/blob/client'
import { useAuth, useUser, SignIn, UserButton } from '@clerk/clerk-react'
import ProjectDashboard from './components/ProjectDashboard.jsx'
import SSGIPostProcessing from './components/SSGIPostProcessing.jsx'

extend(THREE)

const StableEnvironment = memo(function StableEnvironment({ intensity }) {
  return <Environment preset="studio" background={false} environmentIntensity={intensity} />
})

const DEFAULT_MATERIAL = { color: '#cccccc', roughness: 0.5, metalness: 0, textureUrl: null, textureScale: 1 }

function nullBlobTextureUrls(mat) {
  if (!mat || typeof mat !== 'object') return mat
  const result = { ...mat }
  if (result.textureUrl?.startsWith('blob:')) result.textureUrl = null
  if (result.meshMaterials) {
    const mm = {}
    for (const [k, v] of Object.entries(result.meshMaterials)) {
      mm[k] = nullBlobTextureUrls(v)
    }
    result.meshMaterials = mm
  }
  return result
}

function encodeScene(placedFurniture) {
  const serializable = placedFurniture.map(item => ({
    ...item,
    material: nullBlobTextureUrls(item.material),
  }))
  try {
    return btoa(encodeURIComponent(JSON.stringify(serializable)))
  } catch {
    return null
  }
}

function decodeScene(encoded) {
  try {
    return JSON.parse(decodeURIComponent(atob(encoded)))
  } catch {
    return null
  }
}


function YArrow({ onDrag, orbitRef, baseY, onDragCommit }) {
  const isDragging = useRef(false)
  const lastY = useRef(0)

  const handleDown = (e) => {
    e.stopPropagation()
    e.target.setPointerCapture(e.pointerId)
    isDragging.current = true
    lastY.current = e.clientY
    if (orbitRef?.current) orbitRef.current.enabled = false
    onDragCommit?.()
  }
  const handleMove = (e) => {
    if (!isDragging.current) return
    e.stopPropagation()
    const delta = (lastY.current - e.clientY) * 0.01
    onDrag(delta)
    lastY.current = e.clientY
  }
  const handleUp = (e) => {
    e.target.releasePointerCapture(e.pointerId)
    isDragging.current = false
    if (orbitRef?.current) orbitRef.current.enabled = true
  }

  return (
    <group position={[0, baseY, 0]}>
      {/* Shaft */}
      <mesh position={[0, 1, 0]}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
      >
        <cylinderGeometry args={[0.02, 0.02, 2, 8]} />
        <meshStandardMaterial color="#51cf66" depthTest={false} />
      </mesh>
      {/* Arrowhead */}
      <mesh position={[0, 2.15, 0]}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
      >
        <coneGeometry args={[0.07, 0.3, 8]} />
        <meshStandardMaterial color="#51cf66" depthTest={false} />
      </mesh>
    </group>
  )
}

function DraggableMeshBase({ clonedScene, position, scale, rotation, partTransforms, floorPlane, onDragStart, onDragEnd, onSelect, materialSettings, onMeshListUpdate, onPositionChange, onDragCommit, isEmbed, isSelected, zMoveActive, rotPanelActive, onUpdateRotation, onUpdatePartTransform, selectedPart, orbitRef }) {
  const groupRef = useRef()
  const pos = useRef(position)
  const offset = useRef([0, 0])
  const selectedMeshRef = useRef(null)
  const origPositionsRef = useRef(null) // original mesh positions/rotations from file

  const [arrowBase, setArrowBase] = useState(0)

  useEffect(() => {
    if (groupRef.current) {
      const box = new THREE.Box3().setFromObject(groupRef.current)
      setArrowBase(box.min.y - groupRef.current.position.y)
    }
  }, [clonedScene])

  // Track the selected sub-mesh imperatively
  useEffect(() => {
    if (selectedPart === 'all' || !clonedScene) { selectedMeshRef.current = null; return }
    const meshes = []
    clonedScene.traverse(child => { if (child.isMesh) meshes.push(child) })
    selectedMeshRef.current = meshes[parseInt(selectedPart)] || null
  }, [selectedPart, clonedScene])

  // Capture original mesh positions/rotations once when scene loads (before any edits)
  useEffect(() => {
    if (!clonedScene) return
    const orig = {}
    const meshes = []
    clonedScene.traverse(child => { if (child.isMesh) meshes.push(child) })
    meshes.forEach((mesh, i) => {
      orig[i] = {
        position: [mesh.position.x, mesh.position.y, mesh.position.z],
        rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
      }
    })
    origPositionsRef.current = orig
  }, [clonedScene])

  // Apply saved per-part transforms — resets to originals first so undo works correctly
  useEffect(() => {
    if (!clonedScene) return
    const meshes = []
    clonedScene.traverse(child => { if (child.isMesh) meshes.push(child) })
    meshes.forEach((mesh, i) => {
      const orig = origPositionsRef.current?.[i]
      if (orig) {
        mesh.position.fromArray(orig.position)
        mesh.rotation.set(orig.rotation[0], orig.rotation[1], orig.rotation[2])
      }
      const t = partTransforms?.[String(i)]
      if (!t) return
      if (t.position) mesh.position.fromArray(t.position)
      if (t.rotation) mesh.rotation.set(
        THREE.MathUtils.degToRad(t.rotation.x ?? 0),
        THREE.MathUtils.degToRad(t.rotation.y ?? 0),
        THREE.MathUtils.degToRad(t.rotation.z ?? 0),
      )
    })
  }, [clonedScene, JSON.stringify(partTransforms)]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (groupRef.current && scale) {
      groupRef.current.scale.set(scale.x ?? 1, scale.y ?? 1, scale.z ?? 1)
    }
  }, [scale, clonedScene])

  useEffect(() => {
    if (groupRef.current) {
      groupRef.current.rotation.set(
        THREE.MathUtils.degToRad(rotation?.x ?? 0),
        THREE.MathUtils.degToRad(rotation?.y ?? 0),
        THREE.MathUtils.degToRad(rotation?.z ?? 0),
      )
    }
  }, [rotation?.x, rotation?.y, rotation?.z])

  useEffect(() => {
    if (clonedScene && onMeshListUpdate) {
      const meshes = []
      clonedScene.traverse((child) => {
        if (child.isMesh) {
          meshes.push({ name: child.name || `Mesh ${meshes.length + 1}`, uuid: child.uuid })
        }
      })
      onMeshListUpdate(meshes)
    }
  }, [clonedScene, onMeshListUpdate])

  useEffect(() => {
    if (clonedScene && materialSettings) {
      let meshIndex = 0
      clonedScene.traverse((child) => {
        if (child.isMesh) {
          const meshMaterials = materialSettings.meshMaterials || {}
          const settings = meshMaterials[meshIndex] || materialSettings
          let texture = null
          if (settings.textureUrl) {
            const loader = new THREE.TextureLoader()
            texture = loader.load(settings.textureUrl)
            texture.colorSpace = THREE.SRGBColorSpace
            texture.wrapS = THREE.RepeatWrapping
            texture.wrapT = THREE.RepeatWrapping
            texture.repeat.set(settings.textureScale || 1, settings.textureScale || 1)
          }
          if (child.material) {
            if (child.material.map) child.material.map.dispose()
            child.material.dispose()
          }
          child.material = new THREE.MeshStandardNodeMaterial({
            color: texture ? '#ffffff' : (settings.color || '#cccccc'),
            roughness: settings.roughness !== undefined ? settings.roughness : 0.5,
            metalness: settings.metalness !== undefined ? settings.metalness : 0,
            map: texture,
          })
          meshIndex++
        }
      })
    }
  }, [clonedScene, JSON.stringify(materialSettings)]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const group = groupRef.current
    if (!group || !isSelected || !clonedScene) return

    const isPartSelected = selectedPart !== 'all'
    const sourceGeos = []
    let targetParent

    if (isPartSelected) {
      const meshes = []
      clonedScene.traverse(child => { if (child.isMesh && child.geometry) meshes.push(child) })
      const mesh = meshes[parseInt(selectedPart)]
      if (!mesh) return
      // Parent the outline to the part mesh itself — it follows automatically when the mesh moves
      targetParent = mesh
      sourceGeos.push(mesh.geometry.clone()) // geometry is already in mesh local space
    } else {
      targetParent = group
      group.updateWorldMatrix(true, true)
      const invGroup = new THREE.Matrix4().copy(group.matrixWorld).invert()
      clonedScene.traverse(child => {
        if (!child.isMesh || !child.geometry) return
        const geo = child.geometry.clone()
        geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(invGroup, child.matrixWorld))
        sourceGeos.push(geo)
      })
    }

    if (!sourceGeos.length) return
    const merged = sourceGeos.length === 1 ? sourceGeos[0] : mergeGeometries(sourceGeos, false)
    if (sourceGeos.length > 1) sourceGeos.forEach(g => g.dispose())
    if (!merged) return

    const expandedGeo = merged.clone()
    const posAttr = expandedGeo.getAttribute('position')
    const norAttr = expandedGeo.getAttribute('normal')
    if (posAttr && norAttr) {
      const thickness = 0.0175
      for (let i = 0; i < posAttr.count; i++) {
        posAttr.setXYZ(i,
          posAttr.getX(i) + norAttr.getX(i) * thickness,
          posAttr.getY(i) + norAttr.getY(i) * thickness,
          posAttr.getZ(i) + norAttr.getZ(i) * thickness
        )
      }
      posAttr.needsUpdate = true
    }
    const outlineMat = new THREE.MeshBasicNodeMaterial({
      color: new THREE.Color(isPartSelected ? '#ffaa44' : '#89c4ff'),
      side: THREE.BackSide,
      depthTest: true,
      depthWrite: false,
    })
    const outlineMesh = new THREE.Mesh(expandedGeo, outlineMat)
    outlineMesh.renderOrder = 1
    outlineMesh.castShadow = false
    outlineMesh.receiveShadow = false
    targetParent.add(outlineMesh)

    return () => {
      outlineMat.dispose()
      merged.dispose()
      expandedGeo.dispose()
      targetParent.remove(outlineMesh)
    }
  }, [isSelected, selectedPart, clonedScene])

  const bind = useDrag(({ active, first, last, event }) => {
    const partMesh = isSelected ? selectedMeshRef.current : null
    if (first) {
      onDragStart()
      onSelect()
      if (event.ray) {
        const intersect = new THREE.Vector3()
        event.ray.intersectPlane(floorPlane, intersect)
        if (partMesh) {
          const worldPos = new THREE.Vector3()
          partMesh.getWorldPosition(worldPos)
          offset.current = [worldPos.x - intersect.x, worldPos.z - intersect.z]
        } else {
          offset.current = [
            groupRef.current.position.x - intersect.x,
            groupRef.current.position.z - intersect.z,
          ]
        }
      }
    }
    if (last) {
      onDragCommit?.()
      onDragEnd()
      if (partMesh) {
        const existing = partTransforms?.[selectedPart] ?? {}
        onUpdatePartTransform?.(selectedPart, {
          ...existing,
          position: [partMesh.position.x, partMesh.position.y, partMesh.position.z],
        })
      } else {
        if (onPositionChange) onPositionChange([...pos.current])
      }
    }
    if (active && event.ray) {
      const intersect = new THREE.Vector3()
      event.ray.intersectPlane(floorPlane, intersect)
      if (partMesh) {
        const parent = partMesh.parent
        if (parent) {
          parent.updateWorldMatrix(true, false)
          const worldTarget = new THREE.Vector3(
            intersect.x + offset.current[0],
            0,
            intersect.z + offset.current[1]
          )
          parent.worldToLocal(worldTarget)
          partMesh.position.x = worldTarget.x
          partMesh.position.z = worldTarget.z
        }
      } else {
        pos.current = [
          intersect.x + offset.current[0],
          position[1],
          intersect.z + offset.current[1],
        ]
        groupRef.current.position.set(...pos.current)
      }
    }
  }, { pointerEvents: true })

  if (!clonedScene) return null

  return (
    <group ref={groupRef} position={position} {...(isEmbed || (zMoveActive && isSelected) ? {} : bind())}>
      <primitive object={clonedScene} />
      {zMoveActive && isSelected && !isEmbed && (
        <YArrow orbitRef={orbitRef} baseY={arrowBase} onDragCommit={onDragCommit} onDrag={(delta) => {
          const mesh = selectedMeshRef.current
          if (mesh) {
            const newY = mesh.position.y + delta
            mesh.position.y = newY
            const existing = partTransforms?.[selectedPart] ?? {}
            const newPos = [mesh.position.x, newY, mesh.position.z]
            onUpdatePartTransform?.(selectedPart, { ...existing, position: newPos })
          } else {
            const newY = groupRef.current.position.y + delta
            groupRef.current.position.y = newY
            pos.current = [pos.current[0], newY, pos.current[2]]
            if (onPositionChange) onPositionChange([...pos.current])
          }
        }} />
      )}
      {rotPanelActive && isSelected && !isEmbed && (
        <Html position={[0, Math.max(1.8, -arrowBase + 1.2), 0]} style={{ pointerEvents: 'auto' }}>
          <div style={{
            background: '#242424',
            border: '1px solid #3a3a3a',
            borderRadius: '6px',
            padding: '8px 2px 8px 10px',
            width: '210px',
            fontFamily: 'Arial, sans-serif',
            fontSize: '12px',
            color: '#ccc',
            boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
            transform: 'translateX(14px)',
            userSelect: 'none',
          }}>
            <div style={{ color: '#666', fontSize: '10px', letterSpacing: '0.08em', marginBottom: '6px', paddingRight: '8px' }}>
              {selectedPart !== 'all' ? `ROTATION · PART ${parseInt(selectedPart) + 1}` : 'ROTATION'}
            </div>
            {[
              { axis: 'x', color: '#e05252' },
              { axis: 'y', color: '#52b352' },
              { axis: 'z', color: '#5285e0' },
            ].map(({ axis, color }) => {
              const partRot = partTransforms?.[selectedPart]?.rotation
              const value = selectedPart !== 'all'
                ? (partRot?.[axis] ?? 0)
                : (rotation?.[axis] ?? 0)
              return (
                <div key={axis} style={{ display: 'flex', alignItems: 'center', marginBottom: '4px', gap: '6px' }}>
                  <span style={{ color, width: '12px', fontWeight: 'bold', fontSize: '11px', flexShrink: 0 }}>{axis.toUpperCase()}</span>
                  <input
                    type="number"
                    step="1"
                    value={Math.round(value * 10) / 10}
                    onChange={e => {
                      const deg = parseFloat(e.target.value) || 0
                      if (selectedPart !== 'all') {
                        const mesh = selectedMeshRef.current
                        if (mesh) {
                          mesh.rotation[axis] = THREE.MathUtils.degToRad(deg)
                          const existing = partTransforms?.[selectedPart] ?? {}
                          onUpdatePartTransform?.(selectedPart, {
                            ...existing,
                            rotation: { ...(existing.rotation ?? {}), [axis]: deg },
                          })
                        }
                      } else {
                        onUpdateRotation(axis, deg)
                      }
                    }}
                    onPointerDown={e => e.stopPropagation()}
                    style={{
                      flex: 1, background: '#1a1a1a', border: '1px solid #3a3a3a',
                      borderRadius: '3px', color: '#ddd', padding: '3px 6px',
                      fontSize: '12px', outline: 'none', width: 0,
                    }}
                  />
                  <span style={{ color: '#666', fontSize: '11px', paddingRight: '8px' }}>°</span>
                </div>
              )
            })}
          </div>
        </Html>
      )}
    </group>
  )
}

function DraggableFurniture({ path, ...rest }) {
  const { scene } = useGLTF(path)
  const clonedScene = useMemo(() => {
    const clone = scene.clone(true)
    const box = new THREE.Box3().setFromObject(clone)
    const center = new THREE.Vector3()
    box.getCenter(center)
    clone.traverse((child) => {
      if (child.isMesh && child.geometry) {
        child.geometry = child.geometry.clone()
        child.geometry.translate(-center.x, -box.min.y, -center.z)
      }
    })
    return clone
  }, [scene])
  return <DraggableMeshBase clonedScene={clonedScene} {...rest} />
}

function floorSnap(obj3d) {
  const box = new THREE.Box3().setFromObject(obj3d)
  const center = new THREE.Vector3()
  box.getCenter(center)
  obj3d.traverse((child) => {
    if (child.isMesh && child.geometry) {
      child.geometry = child.geometry.clone()
      child.geometry.translate(-center.x, -box.min.y, -center.z)
    }
  })
}

async function loadMesh(sourceUrl, fileFormat) {
  const ext = fileFormat?.toLowerCase()
  let obj3d = null

  if (ext === 'obj') {
    const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js')
    obj3d = await new Promise((resolve, reject) =>
      new OBJLoader().load(sourceUrl, resolve, undefined, reject)
    )
  } else if (ext === 'stl') {
    const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js')
    const geom = await new Promise((resolve, reject) =>
      new STLLoader().load(sourceUrl, resolve, undefined, reject)
    )
    geom.computeVertexNormals()
    const group = new THREE.Group()
    group.add(new THREE.Mesh(geom, new THREE.MeshStandardNodeMaterial()))
    obj3d = group
  } else if (ext === 'fbx') {
    const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js')
    obj3d = await new Promise((resolve, reject) =>
      new FBXLoader().load(sourceUrl, resolve, undefined, reject)
    )
  } else if (ext === 'stp' || ext === 'step') {
    const { default: initOpenCascade } = await import('occt-import-js')
    const occt = await initOpenCascade({
      locateFile: (path) =>
        new URL(`/node_modules/occt-import-js/dist/${path}`, import.meta.url).href,
    })
    const buffer = await fetch(sourceUrl).then((r) => r.arrayBuffer())
    const result = occt.ReadStepFile(new Uint8Array(buffer), null)
    if (!result.success) throw new Error('STEP parse failed')
    const group = new THREE.Group()
    for (const mesh of result.meshes) {
      const geom = new THREE.BufferGeometry()
      geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(mesh.attributes.position.array), 3))
      if (mesh.attributes.normal) {
        geom.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(mesh.attributes.normal.array), 3))
      }
      if (mesh.index) {
        geom.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.index.array), 1))
      } else {
        geom.computeVertexNormals()
      }
      group.add(new THREE.Mesh(geom, new THREE.MeshStandardNodeMaterial({ color: '#cccccc', side: THREE.DoubleSide })))
    }
    obj3d = group
  }

  if (!obj3d) return null
  floorSnap(obj3d)
  return obj3d
}

function DraggableUploadedMesh({ sourceUrl, fileFormat, ...rest }) {
  const [clonedScene, setClonedScene] = useState(null)
  useEffect(() => {
    if (!sourceUrl) return
    loadMesh(sourceUrl, fileFormat)
      .then((obj3d) => { if (obj3d) setClonedScene(obj3d) })
      .catch((err) => console.error('Mesh load error:', err))
  }, [sourceUrl, fileFormat])
  return <DraggableMeshBase clonedScene={clonedScene} {...rest} />
}

function FPSControls({ onLockChange }) {
  const keys = useRef({})
  const controlsRef = useRef()

  useEffect(() => {
    const onKeyDown = (e) => { keys.current[e.code] = true }
    const onKeyUp = (e) => { keys.current[e.code] = false }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  useFrame(({ camera }) => {
    if (!controlsRef.current?.isLocked) return
    const speed = 0.05
    const forward = new THREE.Vector3()
    const right = new THREE.Vector3()
    camera.getWorldDirection(forward)
    forward.y = 0
    forward.normalize()
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()
    const move = new THREE.Vector3()
    if (keys.current['KeyW'] || keys.current['ArrowUp']) move.add(forward)
    if (keys.current['KeyS'] || keys.current['ArrowDown']) move.sub(forward)
    if (keys.current['KeyA'] || keys.current['ArrowLeft']) move.sub(right)
    if (keys.current['KeyD'] || keys.current['ArrowRight']) move.add(right)
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed)
    camera.position.addScaledVector(move, 1)
    camera.position.y = 1.7
  })

  return (
    <PointerLockControls
      ref={controlsRef}
      onLock={() => onLockChange(true)}
      onUnlock={() => onLockChange(false)}
    />
  )
}

export function Scene({ placedFurniture, selectedId, setSelectedId, isDragging, setIsDragging, onMeshListUpdate, onUpdatePosition, isEmbed, navMode, onPointerLockChange, zMoveActive, onDragCommit, envIntensity, pointLightIntensity, rotPanelActive, onUpdateRotation, onUpdatePartTransform, selectedPart }) {
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  const isFps = navMode === 'fps'
  const orbitRef = useRef()
  return (
    <>
      <StableEnvironment intensity={envIntensity ?? 0.5} />

      <ambientLight intensity={0.3} color="#ffffff" />

      <directionalLight position={[5, 8, 5]} intensity={1.8} castShadow
        shadow-bias={-0.002}
        shadow-normalBias={0.3}
        shadow-radius={3}
        shadow-mapSize={[1024, 1024]}
      >
        <orthographicCamera attach="shadow-camera" left={-15} right={15} top={15} bottom={-15} near={0.5} far={50} />
      </directionalLight>

      <directionalLight position={[-4, 5, -3]} intensity={0.7} />
      <directionalLight position={[0, 3, -8]} intensity={0.35} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[100, 100]} />
        <meshStandardNodeMaterial color="#ffffff" roughness={0.1} metalness={0.1} side={THREE.DoubleSide} />
      </mesh>

      {placedFurniture.map((item) => {
        const fmt = item.fileFormat?.toLowerCase()
        const isGltf = !fmt || fmt === 'glb' || fmt === 'gltf'
        const sharedProps = {
          position: item.position,
          scale: item.scale ?? { x: 1, y: 1, z: 1 },
          rotation: item.rotation ?? { x: 0, y: 0, z: 0 },
          partTransforms: item.partTransforms ?? {},
          floorPlane,
          onDragStart: () => setIsDragging(true),
          onDragEnd: () => setIsDragging(false),
          onSelect: () => setSelectedId(item.instanceId),
          materialSettings: item.material,
          onMeshListUpdate: (meshes) => onMeshListUpdate(item.instanceId, meshes),
          onPositionChange: (newPos) => onUpdatePosition(item.instanceId, newPos),
          onDragCommit,
          isEmbed: isEmbed || isFps,
          isSelected: selectedId === item.instanceId,
          zMoveActive,
          rotPanelActive,
          onUpdateRotation: onUpdateRotation ? (axis, deg) => onUpdateRotation(item.instanceId, axis, deg) : undefined,
          onUpdatePartTransform: onUpdatePartTransform ? (partIndex, transforms) => onUpdatePartTransform(item.instanceId, partIndex, transforms) : undefined,
          selectedPart: selectedId === item.instanceId ? selectedPart : 'all',
          orbitRef,
        }
        return (
          <Suspense key={item.instanceId} fallback={null}>
            {isGltf
              ? <DraggableFurniture path={item.file || item.sourceUrl} {...sharedProps} />
              : <DraggableUploadedMesh sourceUrl={item.sourceUrl} fileFormat={fmt} {...sharedProps} />
            }
          </Suspense>
        )
      })}

      {isFps
        ? <FPSControls onLockChange={onPointerLockChange} />
        : <OrbitControls makeDefault enabled={!isDragging} ref={orbitRef} />
      }

    </>
  )
}

export function ViewportMode({ mode, placedFurniture }) {
  const { scene } = useThree()
  const cleanupRef = useRef([])

  useEffect(() => {
    cleanupRef.current.forEach(fn => fn())
    cleanupRef.current = []

    if (mode !== 'mesh') return

    scene.traverse(obj => {
      if (!obj.isMesh) return
      const origMaterial = obj.material
      const clayMat = new THREE.MeshStandardNodeMaterial({ color: 0x999999, roughness: 0.85, metalness: 0 })
      obj.material = clayMat
      cleanupRef.current.push(() => {
        obj.material = origMaterial
        clayMat.dispose()
      })
    })
  }, [mode, scene, placedFurniture?.length])

  return null
}

function Sidebar({ onDeleteSelected, onSelectItem, selectedId, placedFurniture, meshLists, onSaveProject, currentProjectName, onGoToDashboard, onUploadMesh, selectedPart, onPartSelect }) {
  const [showEmbed, setShowEmbed] = useState(false)
  const [baseUrl, setBaseUrl] = useState('')
  const [embedWidth, setEmbedWidth] = useState(800)
  const [embedHeight, setEmbedHeight] = useState(600)
  const [copied, setCopied] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [shareMsg, setShareMsg] = useState(null)

  useEffect(() => {
    setBaseUrl(window.location.origin + window.location.pathname)
  }, [])

  const getIframeCode = () => {
    const encoded = encodeScene(placedFurniture)
    if (!encoded) return '// Scene could not be encoded'
    const src = `${baseUrl.replace(/\/$/, '')}?embed=1#scene=${encoded}`
    return `<iframe\n  src="${src}"\n  width="${embedWidth}"\n  height="${embedHeight}"\n  frameborder="0"\n  allow="fullscreen"\n></iframe>`
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(getIframeCode()).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const handleShareLink = async () => {
    setSharing(true)
    setShareMsg(null)
    try {
      const furniture = placedFurniture.map(item => ({ ...item, material: nullBlobTextureUrls(item.material) }))
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scene: JSON.stringify({ furniture }) }),
      })
      if (!res.ok) throw new Error('Server error')
      const { id } = await res.json()
      await navigator.clipboard.writeText(`https://postmodel.vercel.app/view/${id}`)
      setShareMsg('Link copied!')
    } catch {
      setShareMsg('Failed — try again')
    } finally {
      setSharing(false)
      setTimeout(() => setShareMsg(null), 3000)
    }
  }

  const btnStyle = { width: '100%', padding: '10px', background: '#333', border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer', fontSize: '13px', textAlign: 'left' }

  return (
    <div style={{
      position: 'absolute', left: 0, top: 0, width: '240px', height: '100vh',
      background: '#1a1a1a', padding: '20px', boxSizing: 'border-box',
      color: 'white', fontFamily: 'Arial, sans-serif', overflowY: 'auto', zIndex: 100,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <button onClick={onGoToDashboard} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '13px', padding: '4px 0' }}>
          ← Projects
        </button>
        <UserButton />
      </div>

      {/* Save Project */}
      <button onClick={onSaveProject} style={{ ...btnStyle, background: '#1a5c2a', marginBottom: '20px' }}>
        {currentProjectName ? `💾 Save "${currentProjectName}"` : '💾 Save Project'}
      </button>

      {/* Import */}
      <div style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>IMPORT</div>
      <button onClick={onUploadMesh} style={btnStyle}>↑ Upload Mesh</button>

      {/* Scene outliner — Blender-style hierarchy */}
      {placedFurniture.length > 0 && (
        <>
          <div style={{ fontSize: '11px', color: '#555', marginBottom: '4px', marginTop: '24px', letterSpacing: '0.06em' }}>
            SCENE
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {placedFurniture.map((item, index) => {
              const itemMeshList = meshLists[item.instanceId] || []
              const isItemSelected = selectedId === item.instanceId
              return (
                <div key={item.instanceId}>
                  {/* Object row */}
                  <div
                    onClick={() => { onSelectItem(item.instanceId); onPartSelect('all') }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '5px',
                      padding: '4px 6px',
                      background: isItemSelected && selectedPart === 'all' ? '#2a4a6a' : 'transparent',
                      borderRadius: '3px', cursor: 'pointer',
                      fontSize: '12px', color: isItemSelected ? '#e8e8e8' : '#aaa',
                      userSelect: 'none',
                    }}
                    onMouseEnter={e => { if (!(isItemSelected && selectedPart === 'all')) e.currentTarget.style.background = '#252525' }}
                    onMouseLeave={e => { e.currentTarget.style.background = isItemSelected && selectedPart === 'all' ? '#2a4a6a' : 'transparent' }}
                  >
                    <svg viewBox="0 0 16 16" width="11" height="11" style={{ flexShrink: 0, opacity: 0.55 }}>
                      <path d="M8 1 L14 4.5 L14 11.5 L8 15 L2 11.5 L2 4.5 Z" fill="currentColor" />
                    </svg>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.name}#{index + 1}
                    </span>
                  </div>
                  {/* Sub-mesh rows — always visible */}
                  {itemMeshList.length > 1 && itemMeshList.map((mesh, meshIndex) => {
                    const isPartSel = isItemSelected && selectedPart === String(meshIndex)
                    return (
                      <div
                        key={mesh.uuid}
                        onClick={() => { onSelectItem(item.instanceId); onPartSelect(String(meshIndex)) }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '5px',
                          padding: '3px 6px 3px 20px',
                          background: isPartSel ? '#1f3d5c' : 'transparent',
                          borderRadius: '3px', cursor: 'pointer',
                          fontSize: '11px', color: isPartSel ? '#7bb8e8' : '#555',
                          userSelect: 'none',
                        }}
                        onMouseEnter={e => { if (!isPartSel) e.currentTarget.style.background = '#1e1e1e' }}
                        onMouseLeave={e => { e.currentTarget.style.background = isPartSel ? '#1f3d5c' : 'transparent' }}
                      >
                        <svg viewBox="0 0 16 16" width="9" height="9" style={{ flexShrink: 0, opacity: 0.6 }}>
                          <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" />
                          <circle cx="8" cy="8" r="2" fill="currentColor" />
                        </svg>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {mesh.name || `Part ${meshIndex + 1}`}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
          {selectedId && (
            <button onClick={onDeleteSelected} style={{ ...btnStyle, marginTop: '10px', background: '#8B0000' }}>
              🗑️ Delete Selected
            </button>
          )}
        </>
      )}

      {/* Embed / share */}
      <div style={{ marginTop: '24px', borderTop: '1px solid #333', paddingTop: '20px' }}>
        <div style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>EMBED</div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={() => setShowEmbed(!showEmbed)} style={{ flex: 1, padding: '10px', background: '#1a3a5c', border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer', fontSize: '13px' }}>
            {showEmbed ? 'Hide iframe' : 'iframe code'}
          </button>
          <button onClick={handleShareLink} disabled={sharing} style={{ flex: 1, padding: '10px', background: shareMsg === 'Link copied!' ? '#1a5c2a' : shareMsg ? '#5c1a1a' : '#1a3a5c', border: 'none', borderRadius: '6px', color: 'white', cursor: sharing ? 'default' : 'pointer', fontSize: '13px', opacity: sharing ? 0.7 : 1 }}>
            {shareMsg ?? (sharing ? 'Sharing…' : 'Share link')}
          </button>
        </div>

        {showEmbed && (
          <div style={{ marginTop: '12px' }}>
            <label style={{ fontSize: '12px', color: '#888' }}>Base URL</label>
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
              style={{ width: '100%', padding: '6px', marginTop: '4px', background: '#333', color: 'white', border: 'none', borderRadius: '4px', fontSize: '12px', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '12px', color: '#888' }}>Width</label>
                <input type="number" value={embedWidth} onChange={(e) => setEmbedWidth(Number(e.target.value))}
                  style={{ width: '100%', padding: '6px', marginTop: '4px', background: '#333', color: 'white', border: 'none', borderRadius: '4px', fontSize: '12px', boxSizing: 'border-box' }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '12px', color: '#888' }}>Height</label>
                <input type="number" value={embedHeight} onChange={(e) => setEmbedHeight(Number(e.target.value))}
                  style={{ width: '100%', padding: '6px', marginTop: '4px', background: '#333', color: 'white', border: 'none', borderRadius: '4px', fontSize: '12px', boxSizing: 'border-box' }} />
              </div>
            </div>
            <textarea readOnly value={getIframeCode()} rows={6}
              style={{ width: '100%', marginTop: '8px', padding: '8px', background: '#111', color: '#7ec8e3', border: '1px solid #333', borderRadius: '4px', fontSize: '11px', fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box' }} />
            <button onClick={handleCopy}
              style={{ marginTop: '6px', padding: '8px', background: copied ? '#1a5c2a' : '#333', border: 'none', borderRadius: '4px', color: 'white', cursor: 'pointer', width: '100%', fontSize: '12px' }}>
              {copied ? 'Copied!' : 'Copy Code'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function App() {
  const isEmbed = new URLSearchParams(window.location.search).get('embed') === '1'
  const { isLoaded, isSignedIn, userId } = useAuth()
  const { user } = useUser()

  const [placedFurniture, setPlacedFurniture] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [spawnOffset, setSpawnOffset] = useState(0)
  const [meshLists, setMeshLists] = useState({})
  const [navMode, setNavMode] = useState('orbit')
  const [isPointerLocked, setIsPointerLocked] = useState(false)
  const [zMoveActive, setZMoveActive] = useState(false)
  const [rotPanelActive, setRotPanelActive] = useState(false)
  const [selectedPart, setSelectedPart] = useState('all')
  const [envIntensity, setEnvIntensity] = useState(0.09)
  const [pointLightIntensity, setPointLightIntensity] = useState(1.0)
  const [renderMode, setRenderMode] = useState('rendered')
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [scaleLocked, setScaleLocked] = useState(true)
  const [scaleInputs, setScaleInputs] = useState({ x: '1', y: '1', z: '1' })
  const [appScreen, setAppScreen] = useState('dashboard')
  const [currentProjectId, setCurrentProjectId] = useState(null)
  const [currentProjectName, setCurrentProjectName] = useState(null)
  const [saveToast, setSaveToast] = useState(null)
  const uploadInputRef = useRef()
  const history = useRef([])
  const canvasPointerDown = useRef(null)

  const saveHistory = (current) => {
    history.current = [...history.current.slice(-19), current]
  }

  useEffect(() => {
    if (isEmbed) return
    const onKeyDown = (e) => {
      if (!e.ctrlKey && (e.key === 'z' || e.key === 'Z')) setZMoveActive(prev => !prev)
      if (!e.ctrlKey && (e.key === 'r' || e.key === 'R') && selectedId) setRotPanelActive(prev => !prev)
      if (e.ctrlKey && e.key === 'z') {
        if (history.current.length > 0) {
          setPlacedFurniture(history.current[history.current.length - 1])
          history.current = history.current.slice(0, -1)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isEmbed, selectedId])

  useEffect(() => {
    if (!selectedId) { setRotPanelActive(false); setSelectedPart('all') }
    else setSelectedPart('all')
  }, [selectedId])

  // Restore scene from URL hash when loaded as an embed
  useEffect(() => {
    const match = window.location.hash.match(/#scene=(.+)/)
    if (match) {
      const decoded = decodeScene(match[1])
      if (decoded) setPlacedFurniture(decoded)
    }
  }, [])

  const deleteSelected = () => {
    saveHistory(placedFurniture)
    setPlacedFurniture(placedFurniture.filter(item => item.instanceId !== selectedId))
    setSelectedId(null)
  }

  const updateMaterial = (instanceId, newMaterial) => {
    saveHistory(placedFurniture)
    setPlacedFurniture(placedFurniture.map(item =>
      item.instanceId === instanceId
        ? { ...item, material: newMaterial }
        : item
    ))
  }

  const handleMeshListUpdate = (instanceId, meshes) => {
    setMeshLists(prev => ({
      ...prev,
      [instanceId]: meshes
    }))
  }

  // Sync scale inputs when selection changes
  useEffect(() => {
    const item = placedFurniture.find(i => i.instanceId === selectedId)
    if (item) {
      const s = item.scale ?? { x: 1, y: 1, z: 1 }
      setScaleInputs({ x: String(s.x), y: String(s.y), z: String(s.z) })
    }
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleScaleChange = (axis, rawVal) => {
    const newNum = parseFloat(rawVal)
    if (scaleLocked) {
      setScaleInputs({ x: rawVal, y: rawVal, z: rawVal })
      if (isFinite(newNum) && newNum > 0) {
        updateScale(selectedId, { x: newNum, y: newNum, z: newNum })
      }
    } else {
      setScaleInputs(prev => ({ ...prev, [axis]: rawVal }))
      if (isFinite(newNum) && newNum > 0) {
        const current = placedFurniture.find(i => i.instanceId === selectedId)?.scale ?? { x: 1, y: 1, z: 1 }
        updateScale(selectedId, { ...current, [axis]: newNum })
      }
    }
  }

  const commitHistory = () => {
    history.current = [...history.current.slice(-9), JSON.parse(JSON.stringify(placedFurniture))]
  }

  const updatePosition = (instanceId, newPosition) => {
    setPlacedFurniture(prev => prev.map(item =>
      item.instanceId === instanceId ? { ...item, position: newPosition, material: item.material } : item
    ))
  }

  const updatePartTransform = (instanceId, partIndex, transforms) => {
    setPlacedFurniture(prev => prev.map(item =>
      item.instanceId === instanceId
        ? { ...item, partTransforms: { ...(item.partTransforms ?? {}), [partIndex]: { ...(item.partTransforms?.[partIndex] ?? {}), ...transforms } } }
        : item
    ))
  }

  const updateRotation = (instanceId, axis, degrees) => {
    setPlacedFurniture(prev => prev.map(item =>
      item.instanceId === instanceId
        ? { ...item, rotation: { ...(item.rotation ?? { x: 0, y: 0, z: 0 }), [axis]: degrees } }
        : item
    ))
  }

const updateScale = (instanceId, newScale) => {
    setPlacedFurniture(prev => prev.map(item =>
      item.instanceId === instanceId ? { ...item, scale: newScale } : item
    ))
  }

  const handleMeshUpload = async (file) => {
    const ext = file.name.split('.').pop().toLowerCase()
    const supported = ['glb', 'gltf', 'obj', 'stl', 'fbx', 'stp', 'step']
    if (!supported.includes(ext)) {
      setUploadError(`Unsupported format: .${ext}`)
      setTimeout(() => setUploadError(null), 5000)
      return
    }
    const capturedOffset = spawnOffset
    setSpawnOffset(prev => (prev + 1) % 10)
    setIsUploading(true)
    setUploadError(null)
    try {
      // Pre-flight: check quota before handing off to Vercel Blob client
      const tokenCheck = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'blob.generate-client-token', payload: { pathname: file.name, callbackUrl: '', multipart: false, clientPayload: JSON.stringify({ userId: userId || '', fileSize: file.size }) } }),
      })
      if (tokenCheck.status === 403) {
        const data = await tokenCheck.json()
        if (data.error === 'storage_limit_exceeded') {
          throw new Error('storage_limit_exceeded')
        }
      }

      const blob = await upload(file.name, file, {
        access: 'public',
        handleUploadUrl: '/api/upload',
        clientPayload: JSON.stringify({ userId: userId || '', fileSize: file.size }),
      })
      const url = blob.url

      // Record blob + update storage quota
      fetch('/api/upload-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, blobUrl: url, filename: file.name, fileSize: file.size }),
      }).catch(() => {})

      const isGltf = ext === 'glb' || ext === 'gltf'
      const newItem = {
        id: `upload-${Date.now()}`,
        name: file.name,
        file: isGltf ? url : null,
        sourceUrl: url,
        fileFormat: ext,
        instanceId: `upload-${Date.now()}`,
        position: [capturedOffset * 0.5, 0, capturedOffset * 0.5],
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        material: { ...DEFAULT_MATERIAL, meshMaterials: {} },
      }
      saveHistory(placedFurniture)
      setPlacedFurniture(prev => [...prev, newItem])
    } catch (err) {
      if (err.message?.includes('storage_limit_exceeded')) {
        setUploadError('Storage limit reached (100MB on free plan). Upgrade your plan to upload more.')
      } else {
        setUploadError(err.message || 'Upload failed')
      }
      setTimeout(() => setUploadError(null), 7000)
    } finally {
      setIsUploading(false)
    }
  }

  const handleNewProject = () => {
    setPlacedFurniture([])
    setSelectedId(null)
    setCurrentProjectId(null)
    setCurrentProjectName(null)
    setEnvIntensity(0.09)
    setPointLightIntensity(1.0)
    history.current = []
    setAppScreen('editor')
  }

  const handleOpenProject = (projectId, projectName, sceneJson) => {
    const { furniture, lighting } = sceneJson
    setPlacedFurniture(furniture ?? [])
    setSelectedId(null)
    if (lighting) {
      if (lighting.envIntensity != null) setEnvIntensity(lighting.envIntensity)
      if (lighting.pointLightIntensity != null) setPointLightIntensity(lighting.pointLightIntensity)
    }
    history.current = []
    setCurrentProjectId(projectId)
    setCurrentProjectName(projectName)
    setAppScreen('editor')
  }

  const handleSaveProject = async () => {
    let name = currentProjectName
    if (!name) {
      name = window.prompt('Project name:')
      if (!name?.trim()) return
      name = name.trim()
    }
    const sceneJson = {
      furniture: placedFurniture.map(item => ({ ...item, material: nullBlobTextureUrls(item.material) })),
      lighting: { envIntensity, pointLightIntensity },
    }
    try {
      const res = await fetch('/api/project/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, projectId: currentProjectId, name, sceneJson }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setCurrentProjectId(data.projectId)
      setCurrentProjectName(name)
      setSaveToast('Project saved')
      setTimeout(() => setSaveToast(null), 3000)
    } catch (err) {
      setSaveToast(`Save failed: ${err.message}`)
      setTimeout(() => setSaveToast(null), 4000)
    }
  }

  // Auto-create user record on first sign-in
  useEffect(() => {
    if (!isSignedIn || !userId) return
    const email = user?.primaryEmailAddress?.emailAddress
    fetch('/api/ensure-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, email }),
    }).catch(() => {})
  }, [isSignedIn, userId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!isEmbed && !isLoaded) return null
  if (!isEmbed && !isSignedIn) return (
    <div style={{
      width: '100vw', height: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#111',
    }}>
      <SignIn />
    </div>
  )

  if (!isEmbed && appScreen === 'dashboard') return (
    <ProjectDashboard
      userId={userId}
      onNewProject={handleNewProject}
      onOpenProject={handleOpenProject}
    />
  )

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      {/* Hidden file input for mesh upload */}
      <input
        type="file"
        accept=".glb,.gltf,.obj,.stl,.fbx,.stp,.step"
        style={{ display: 'none' }}
        ref={uploadInputRef}
        onChange={(e) => { const f = e.target.files[0]; if (f) handleMeshUpload(f); e.target.value = '' }}
      />
      {!isEmbed && (
        <Sidebar
          onDeleteSelected={deleteSelected}
          onSelectItem={setSelectedId}
          selectedId={selectedId}
          placedFurniture={placedFurniture}
          meshLists={meshLists}
          onSaveProject={handleSaveProject}
          currentProjectName={currentProjectName}
          onGoToDashboard={() => setAppScreen('dashboard')}
          onUploadMesh={() => uploadInputRef.current?.click()}
          selectedPart={selectedPart}
          onPartSelect={setSelectedPart}
        />
      )}

      {/* Floating nav toggle — bottom-right of viewport */}
      {!isEmbed && (
        <button
          onClick={() => { setNavMode(navMode === 'orbit' ? 'fps' : 'orbit'); setIsPointerLocked(false) }}
          style={{
            position: 'absolute',
            bottom: '20px',
            right: '20px',
            zIndex: 200,
            padding: '8px 14px',
            background: 'rgba(30,30,30,0.85)',
            border: '1px solid #444',
            borderRadius: '6px',
            color: 'white',
            cursor: 'pointer',
            fontSize: '13px',
            fontFamily: 'Arial, sans-serif',
            userSelect: 'none',
          }}
        >
          {navMode === 'orbit' ? '🚶 Walk' : '🔄 Orbit'}
        </button>
      )}

      {!isEmbed && navMode === 'fps' && !isPointerLocked && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 200,
          background: 'rgba(0, 0, 0, 0.7)',
          color: 'white',
          padding: '20px 30px',
          borderRadius: '8px',
          textAlign: 'center',
          fontSize: '14px',
          lineHeight: '1.6',
          pointerEvents: 'none',
        }}>
          Click to look around · WASD to move · ESC to exit
        </div>
      )}

      {/* Viewport with drag-and-drop */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: isEmbed ? 0 : 240,
          right: 0,
          bottom: 0,
        }}
        onDragOver={(e) => { e.preventDefault(); if (!isEmbed) setIsDragOver(true) }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setIsDragOver(false) }}
        onDrop={(e) => {
          e.preventDefault()
          setIsDragOver(false)
          if (!isEmbed) { const f = e.dataTransfer.files[0]; if (f) handleMeshUpload(f) }
        }}
      >
        {isDragOver && !isEmbed && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 90,
            border: '3px dashed #4a9eff',
            background: 'rgba(74, 158, 255, 0.08)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none',
          }}>
            <div style={{
              color: '#4a9eff', fontSize: '18px', fontFamily: 'Arial, sans-serif',
              background: 'rgba(0,0,0,0.65)', padding: '14px 24px', borderRadius: '8px',
            }}>
              Drop mesh to upload
            </div>
          </div>
        )}

        {isUploading && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 250,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none',
          }}>
            <div style={{
              color: 'white', fontSize: '15px', fontFamily: 'Arial, sans-serif',
              background: 'rgba(0,0,0,0.75)', padding: '14px 24px', borderRadius: '8px',
            }}>
              Uploading...
            </div>
          </div>
        )}

        {uploadError && (
          <div style={{
            position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
            zIndex: 250, background: '#c0392b', color: 'white',
            padding: '10px 20px', borderRadius: '6px',
            fontFamily: 'Arial, sans-serif', fontSize: '13px', whiteSpace: 'nowrap',
          }}>
            {uploadError}
          </div>
        )}

        {saveToast && (
          <div style={{
            position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
            zIndex: 250,
            background: saveToast.startsWith('Save failed') ? '#c0392b' : '#1a5c2a',
            color: 'white', padding: '10px 20px', borderRadius: '6px',
            fontFamily: 'Arial, sans-serif', fontSize: '13px', whiteSpace: 'nowrap',
          }}>
            {saveToast}
          </div>
        )}

        {/* Viewport shading mode buttons (top-right, Blender-style) */}
        <div style={{
          position: 'absolute', top: '12px', right: '12px', zIndex: 100,
          display: 'flex', gap: '2px',
          background: 'rgba(28,28,28,0.8)', padding: '3px', borderRadius: '6px',
          backdropFilter: 'blur(8px)',
        }}>
          {[
            { id: 'mesh', title: 'Mesh', icon: (
              <svg viewBox="0 0 20 20" width="15" height="15">
                <path d="M10 2 L17 6 L17 14 L10 18 L3 14 L3 6 Z" fill="currentColor"/>
              </svg>
            )},
            { id: 'solid', title: 'Solid', icon: (
              <svg viewBox="0 0 20 20" width="15" height="15"><circle cx="10" cy="10" r="7.5" fill="currentColor"/></svg>
            )},
            { id: 'rendered', title: 'Rendered', icon: (
              <svg viewBox="0 0 20 20" width="15" height="15">
                <circle cx="10" cy="10" r="7.5" fill="currentColor"/>
                <circle cx="7.5" cy="7.5" r="2.5" fill="white" opacity="0.45"/>
              </svg>
            )},
          ].map(({ id, title, icon }) => (
            <button key={id} title={title} onClick={() => setRenderMode(id)} style={{
              width: '28px', height: '28px', padding: 0, cursor: 'pointer',
              border: renderMode === id ? '1px solid rgba(255,255,255,0.35)' : '1px solid transparent',
              borderRadius: '4px',
              background: renderMode === id ? 'rgba(100,100,100,0.9)' : 'transparent',
              color: renderMode === id ? 'white' : 'rgba(160,160,160,0.85)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{icon}</button>
          ))}
        </div>

        <Canvas
          shadows={{ type: THREE.PCFSoftShadowMap }}
          camera={{ position: [5, 5, 5], fov: 50 }}
          dpr={[1, 1.5]}
          style={{ width: '100%', height: '100%', background: '#e0e0e0' }}
          gl={async (props) => {
            const renderer = new THREE.WebGPURenderer({ canvas: props.canvas })
            renderer.toneMapping = THREE.ACESFilmicToneMapping
            renderer.toneMappingExposure = 0.9
            await renderer.init()
            return renderer
          }}
          onPointerDown={e => { canvasPointerDown.current = { x: e.clientX, y: e.clientY } }}
          onPointerMissed={e => {
            const down = canvasPointerDown.current
            if (!down) return
            const dx = e.clientX - down.x
            const dy = e.clientY - down.y
            if (Math.sqrt(dx * dx + dy * dy) < 5) setSelectedId(null)
          }}
        >
          <SSGIPostProcessing mode={renderMode} />
          <ViewportMode mode={renderMode} placedFurniture={placedFurniture} />
          <Suspense fallback={null}>
            <Scene
              placedFurniture={placedFurniture}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
              isDragging={isDragging}
              setIsDragging={setIsDragging}
              onMeshListUpdate={handleMeshListUpdate}
              onUpdatePosition={updatePosition}
              isEmbed={isEmbed}
              navMode={navMode}
              onPointerLockChange={setIsPointerLocked}
              zMoveActive={zMoveActive}
              onDragCommit={commitHistory}
              envIntensity={envIntensity}
              pointLightIntensity={pointLightIntensity}
              rotPanelActive={rotPanelActive}
              onUpdateRotation={updateRotation}
              onUpdatePartTransform={updatePartTransform}
              selectedPart={selectedPart}
            />
          </Suspense>
        </Canvas>
      </div>
    </div>
  )
}

export default App
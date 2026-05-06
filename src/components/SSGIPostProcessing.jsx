import { useEffect, useRef } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import {
  abs,
  add,
  colorToDirection,
  diffuseColor,
  directionToColor,
  float,
  Fn,
  max,
  mix as tslMix,
  mrt,
  normalView,
  output,
  pass,
  sample,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { ssgi } from 'three/examples/jsm/tsl/display/SSGINode.js'
import { denoise } from 'three/examples/jsm/tsl/display/DenoiseNode.js'

const OUTLINE = { r: 1.4, g: 0.45, b: 0.0 } // HDR linear; tone-maps to vivid orange

// Build a Sobel edge-detection node over a mask texture node.
// resUniform is a shared vec2 uniform(width, height) — same ref in both pipelines.
function buildEdgeNode(maskTex, resUniform) {
  return Fn(() => {
    const px = vec2(1.0).div(resUniform)
    const screenUV = uv()
    const s = (ox, oy) => maskTex.uv(screenUV.add(px.mul(vec2(ox, oy)))).r
    const gx = s(-1,-1).mul(-1).add(s(1,-1))
      .add(s(-1, 0).mul(-2)).add(s(1, 0).mul(2))
      .add(s(-1, 1).mul(-1)).add(s(1, 1))
    const gy = s(-1,-1).mul(-1).add(s(-1, 1))
      .add(s( 0,-1).mul(-2)).add(s(0,  1).mul(2))
      .add(s( 1,-1).mul(-1)).add(s(1,  1))
    return max(abs(gx), abs(gy)).clamp(0, 1)
  })()
}

export default function SSGIPostProcessing({ mode = 'rendered', selectedScene = null }) {
  const { gl: renderer, scene, camera, size } = useThree()
  const renderPPRef = useRef(null)  // SSGI pipeline (rendered mode)
  const simplePPRef = useRef(null)  // Plain pipeline (solid / mesh modes)
  const failedRef = useRef(false)
  const maskMeshes = useRef([])
  const resUniformRef = useRef(null)

  // Synchronous lazy-init so both refs are ready before the setup effect runs.
  const maskSceneRef = useRef(null)
  const whiteMatRef = useRef(null)
  if (!maskSceneRef.current) {
    maskSceneRef.current = new THREE.Scene()
    maskSceneRef.current.background = new THREE.Color(0x000000)
  }
  if (!whiteMatRef.current) {
    whiteMatRef.current = new THREE.MeshBasicNodeMaterial({ color: '#ffffff' })
  }

  // Rebuild white-silhouette meshes whenever the selected object changes.
  useEffect(() => {
    const ms = maskSceneRef.current
    maskMeshes.current.forEach(m => ms.remove(m))
    maskMeshes.current = []
    if (!selectedScene) return
    const meshes = []
    selectedScene.traverse(child => {
      if (!child.isMesh) return
      const m = new THREE.Mesh(child.geometry, whiteMatRef.current)
      m.matrixAutoUpdate = false
      m.userData.source = child
      ms.add(m)
      meshes.push(m)
    })
    maskMeshes.current = meshes
  }, [selectedScene])

  // Keep the Sobel pixel-size uniform in sync with viewport size.
  useEffect(() => {
    if (resUniformRef.current) resUniformRef.current.value.set(size.width, size.height)
  }, [size])

  // Build both PostProcessing pipelines once.
  useEffect(() => {
    if (failedRef.current) return
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
      console.warn('[viewer] WebGPU unavailable — rendering without SSGI.')
      failedRef.current = true
      return
    }

    let disposed = false

    try {
      const bgColor = uniform(new THREE.Color('#e0e0e0'))
      const resUniform = uniform(new THREE.Vector2(size.width, size.height))
      resUniformRef.current = resUniform

      // ── RENDERED PIPELINE — SSGI + AO + outline ───────────────────────────────
      const scenePass = pass(scene, camera)
      scenePass.setMRT(mrt({
        output,
        diffuseColor,
        normal: directionToColor(normalView),
      }))

      const scenePassColor  = scenePass.getTextureNode('output')
      const scenePassDiffuse = scenePass.getTextureNode('diffuseColor')
      const scenePassDepth  = scenePass.getTextureNode('depth')
      const scenePassNormal = scenePass.getTextureNode('normal')

      const sceneNormal = sample((uvArg) => colorToDirection(scenePassNormal.sample(uvArg)))

      const giPass = ssgi(scenePassColor, scenePassDepth, sceneNormal, camera)
      giPass.sliceCount.value = 2
      giPass.stepCount.value = 6
      giPass.radius.value = 1.5
      giPass.expFactor.value = 1.5
      giPass.thickness.value = 0.3
      giPass.backfaceLighting.value = 0.3
      giPass.aoIntensity.value = 2.0
      giPass.giIntensity.value = 0
      giPass.useScreenSpaceSampling.value = true
      giPass.useTemporalFiltering = false

      const giTexture = giPass.getTextureNode()
      const aoAsRgb = vec4(giTexture.a, giTexture.a, giTexture.a, float(1))

      const denoisePass = denoise(aoAsRgb, scenePassDepth, sceneNormal, camera)
      denoisePass.index.value = 0
      denoisePass.radius.value = 4

      const gi = giPass.rgb
      const ao = denoisePass.r
      const hasGeometryR = scenePassColor.a

      const ssgiComposite = vec4(
        add(scenePassColor.rgb.mul(ao), scenePassDiffuse.rgb.mul(gi)),
        hasGeometryR,
      )
      const ssgiWithBg = vec4(
        tslMix(bgColor, ssgiComposite.rgb, hasGeometryR),
        float(1),
      )

      // Each pipeline gets its own pass() node for the mask scene to keep the
      // node graphs fully isolated — no shared compiled-shader state between PPs.
      const maskPassR = pass(maskSceneRef.current, camera)
      const edgeR = buildEdgeNode(maskPassR.getTextureNode(), resUniform)

      const renderPP = new THREE.PostProcessing(renderer)
      renderPP.outputNode = vec4(
        tslMix(ssgiWithBg.rgb, vec3(OUTLINE.r, OUTLINE.g, OUTLINE.b), edgeR),
        float(1),
      ).renderOutput()

      // ── SIMPLE PIPELINE — plain scene render + outline (solid / mesh modes) ───
      // Uses the same scene so ViewportMode's material overrides apply correctly.
      const simpleScenePass = pass(scene, camera)
      const simpleColor = simpleScenePass.getTextureNode()
      const hasGeometryS = simpleColor.a

      const simpleWithBg = vec4(
        tslMix(bgColor, simpleColor.rgb, hasGeometryS),
        float(1),
      )

      const maskPassS = pass(maskSceneRef.current, camera)
      const edgeS = buildEdgeNode(maskPassS.getTextureNode(), resUniform)

      const simplePP = new THREE.PostProcessing(renderer)
      simplePP.outputNode = vec4(
        tslMix(simpleWithBg.rgb, vec3(OUTLINE.r, OUTLINE.g, OUTLINE.b), edgeS),
        float(1),
      ).renderOutput()

      if (disposed) { renderPP.dispose(); simplePP.dispose(); return }
      renderPPRef.current = renderPP
      simplePPRef.current = simplePP
    } catch (e) {
      console.warn('[renderer] Pipeline setup failed, falling back to default render:', e)
      failedRef.current = true
    }

    return () => {
      disposed = true
      renderPPRef.current?.dispose(); renderPPRef.current = null
      simplePPRef.current?.dispose(); simplePPRef.current = null
    }
  }, [renderer, scene, camera]) // eslint-disable-line react-hooks/exhaustive-deps

  // Copy source world matrices into mask meshes every frame (before the render).
  // Setting m.matrix (not m.matrixWorld) lets Three.js's updateMatrixWorld() inside
  // pp.render() compute the correct result: maskScene(identity) × m.matrix = src.matrixWorld.
  useFrame(() => {
    maskMeshes.current.forEach(m => {
      const src = m.userData.source
      if (src) {
        src.updateWorldMatrix(true, false)
        m.matrix.copy(src.matrixWorld)
        m.matrixWorldNeedsUpdate = true
      }
    })
  }, 0)

  useFrame(() => {
    const pp = mode === 'rendered' ? renderPPRef.current : simplePPRef.current
    if (failedRef.current || !pp) {
      renderer.render(scene, camera)
      return
    }
    try {
      renderer.setClearAlpha?.(0)
      pp.render()
    } catch (e) {
      console.warn('[renderer] Render error, disabling pipeline:', e)
      failedRef.current = true
      renderPPRef.current?.dispose(); renderPPRef.current = null
      simplePPRef.current?.dispose(); simplePPRef.current = null
    }
  }, 1)

  return null
}

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

const OUTLINE = { r: 1.0, g: 0.55, b: 0.0 }

export default function SSGIPostProcessing({ mode = 'rendered', selectedScene = null }) {
  const { gl: renderer, scene, camera, size } = useThree()
  const ppRef = useRef(null)
  const failedRef = useRef(false)
  const maskMeshes = useRef([])
  const resUniformRef = useRef(null)

  // Lazy-init mask scene and white material (synchronous so setup effect sees them immediately)
  const maskSceneRef = useRef(null)
  const whiteMatRef = useRef(null)
  if (!maskSceneRef.current) {
    maskSceneRef.current = new THREE.Scene()
    maskSceneRef.current.background = new THREE.Color(0x000000)
  }
  if (!whiteMatRef.current) {
    whiteMatRef.current = new THREE.MeshBasicNodeMaterial({ color: '#ffffff' })
  }

  // Rebuild mask meshes when selection changes
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

  // Resize: keep the Sobel pixel-size uniform in sync
  useEffect(() => {
    if (resUniformRef.current) resUniformRef.current.value.set(size.width, size.height)
  }, [size])

  useEffect(() => {
    if (failedRef.current) return

    const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator
    if (!hasWebGPU) {
      console.warn('[viewer] WebGPU unavailable — rendering without SSGI.')
      failedRef.current = true
      return
    }

    let disposed = false

    try {
      const scenePass = pass(scene, camera)

      scenePass.setMRT(mrt({
        output,
        diffuseColor,
        normal: directionToColor(normalView),
      }))

      const scenePassColor = scenePass.getTextureNode('output')
      const scenePassDiffuse = scenePass.getTextureNode('diffuseColor')
      const scenePassDepth = scenePass.getTextureNode('depth')
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

      const hasGeometry = scenePassColor.a

      const sceneColor = vec4(
        add(scenePassColor.rgb.mul(ao), scenePassDiffuse.rgb.mul(gi)),
        hasGeometry,
      )

      const bgColor = uniform(new THREE.Color('#e0e0e0'))
      const composited = vec4(
        tslMix(bgColor, sceneColor.rgb, hasGeometry),
        float(1),
      )

      // ── SELECTION OUTLINE ──────────────────────────────────────────────────────
      // Mask pass renders selected object as white silhouette on black — no direct
      // renderer.render() calls; everything runs inside the PostProcessing graph.
      // To remove: delete from here to END SELECTION OUTLINE, and change
      // pp.outputNode back to composited.renderOutput().
      const maskPass = pass(maskSceneRef.current, camera)
      const maskTex = maskPass.getTextureNode()

      const resUniform = uniform(new THREE.Vector2(size.width, size.height))
      resUniformRef.current = resUniform

      const edgeNode = Fn(() => {
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

      const finalOutput = vec4(
        composited.rgb.add(vec3(OUTLINE.r, OUTLINE.g, OUTLINE.b).mul(edgeNode)),
        float(1),
      )
      // ── END SELECTION OUTLINE ──────────────────────────────────────────────────

      const pp = new THREE.PostProcessing(renderer)
      pp.outputNode = finalOutput.renderOutput()

      if (disposed) { pp.dispose(); return }
      ppRef.current = pp
    } catch (e) {
      console.warn('[renderer] SSGI pipeline setup failed, falling back to default render:', e)
      failedRef.current = true
    }

    return () => {
      disposed = true
      if (ppRef.current) { ppRef.current.dispose(); ppRef.current = null }
    }
  }, [renderer, scene, camera]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync mask mesh world matrices before each frame renders
  useFrame(() => {
    maskMeshes.current.forEach(m => {
      const src = m.userData.source
      if (src) {
        src.updateWorldMatrix(true, false)
        m.matrixWorld.copy(src.matrixWorld)
      }
    })
  }, 0)

  useFrame(() => {
    if (mode !== 'rendered' || failedRef.current || !ppRef.current) {
      renderer.render(scene, camera)
      return
    }
    try {
      renderer.setClearAlpha?.(0)
      ppRef.current.render()
    } catch (e) {
      console.warn('[renderer] SSGI render error, disabling pipeline:', e)
      failedRef.current = true
      if (ppRef.current) { ppRef.current.dispose(); ppRef.current = null }
    }
  }, 1)

  return null
}

import * as turf from '@turf/turf'
import { useEffect, useLayoutEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import ictusData from '../assets/data/data.json'
import comarcasData from '../assets/data/comarcas.json'
import ambulanceSvg from '../assets/icons/ambulance.svg?url'
import ambulanceMsuSvg from '../assets/icons/ambulance_MSU.svg?url'

// ─── Config de las 3 rutas ───────────────────────────────────────────────────
const N = ictusData.features.length
const ROUTES = [
  { key: 'amb',  source: i => `ruta-comarca-${i}`, layer: i => `ruta-line-${i}`,     color: '#ff0000', dash: false },
  { key: 'msu',  source: i => `ruta-msu-${i}`,     layer: i => `ruta-msu-line-${i}`,  color: '#ff8c00', dash: false },
  { key: 'msu2', source: i => `ruta-msu2-${i}`,    layer: i => `ruta-msu2-line-${i}`, color: '#9b59b6', dash: true  },
]

// ─── Caché de rutas y métricas (nivel módulo — persisten entre renders) ───────
const cache   = {}
const lines   = { amb: Array(N).fill(null), msu: Array(N).fill(null), msu2: Array(N).fill(null) }
const lengths = { amb: Array(N).fill(0),    msu: Array(N).fill(0),    msu2: Array(N).fill(0)    }
const speeds  = { amb: Array(N).fill(0),    msu: Array(N).fill(0),    msu2: Array(N).fill(0)    }

// ─── Helpers puros ───────────────────────────────────────────────────────────
const normalize   = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
const kmhToMps    = kmh => (kmh * 1000) / 3600
const mkZeros     = () => Array(N).fill(0)
const geojsonLine = coords => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords } })
const emptyFC     = () => ({ type: 'FeatureCollection', features: [] })

function setVis(map, layerId, visible) {
  map.getLayer(layerId) && map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none')
}

// ─── Directions API ──────────────────────────────────────────────────────────
async function fetchRoute(waypoints, token) {
  const str = waypoints.map(([lng, lat]) => `${lng},${lat}`).join(';')
  const url  = `https://api.mapbox.com/directions/v5/mapbox/driving/${str}?geometries=geojson&overview=full&access_token=${token}`
  try {
    const res  = await fetch(url)
    const data = await res.json()
    if (!res.ok || !data.routes?.length) throw new Error()
    return data.routes[0].geometry.coordinates
  } catch {
    console.warn('[HeatmapRecorridos] Directions fallback a línea recta')
    return waypoints
  }
}

// ─── Guardar ruta y calcular métricas ───────────────────────────────────────
function storeRoute(index, coords, type) {
  const p    = ictusData.features[index].properties
  const line = turf.lineString(coords)
  lines[type][index]   = line
  lengths[type][index] = Math.max(0, turf.length(line, { units: 'meters' }))
  speeds[type][index]  = kmhToMps(
    type === 'amb'  ? (Number(p.modern_ambulance.average_speed_kmh) || 54) :
    type === 'msu'  ? (Number(p.ambulance_msu.average_speed_kmh)    || 66) :
    90 // msu2 — autopista
  )
}

// Prefetch sin bloquear (para setup inicial)
function prefetchRoute(index, type, waypoints, token, map) {
  const k = `${type}-${index}`
  if (cache[k]) return
  cache[k] = 'loading'
  fetchRoute(waypoints, token).then(coords => {
    cache[k] = coords
    storeRoute(index, coords, type)
    const src = ROUTES.find(r => r.key === type).source(index)
    map.getSource(src)?.setData(geojsonLine(coords))
  })
}

// Fetch bloqueante (para cuando el usuario ya hizo click en la comarca)
async function ensureRoute(index, type, waypoints, token, map) {
  const k = `${type}-${index}`
  if (cache[k] && cache[k] !== 'loading') return
  cache[k] = 'loading'
  const coords = await fetchRoute(waypoints, token)
  cache[k] = coords
  storeRoute(index, coords, type)
  const src = ROUTES.find(r => r.key === type).source(index)
  map.getSource(src)?.setData(geojsonLine(coords))
}

// ─── Componente ──────────────────────────────────────────────────────────────
export default function HeatmapRecorridos({ map, activeView, isPlaying, velocidad, resetKey }) {
  const activeViewRef = useRef(activeView)
  const isPlayingRef  = useRef(isPlaying)
  const velocidadRef  = useRef(velocidad)
  useLayoutEffect(() => { activeViewRef.current = activeView }, [activeView])
  useLayoutEffect(() => { isPlayingRef.current  = isPlaying  }, [isPlaying])
  useLayoutEffect(() => { velocidadRef.current  = velocidad  }, [velocidad])

  // markers agrupados por tipo: amb (azul), msu (verde), msu2 (morado)
  const markersRef = useRef({ amb: [], msu: [], msu2: [] })
  const dist       = useRef({ amb: mkZeros(), msu: mkZeros(), msu2: mkZeros() })
  const rafRef     = useRef(null)
  const activeAmb  = useRef(new Set())
  const activeMsu  = useRef(new Set())
  const prevView   = useRef(null)

  const resetDist = () => { dist.current = { amb: mkZeros(), msu: mkZeros(), msu2: mkZeros() } }

  useEffect(() => {
    if (activeView === 'recorridos' && prevView.current !== 'recorridos') resetDist()
    prevView.current = activeView
  }, [activeView])

  useEffect(() => { if (map && activeView === 'recorridos') resetDist() }, [resetKey])

  // ── Efecto 1: Setup ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!map) return

    const setup = () => {
      const seen   = { amb: new Set(), msu: new Set(), msu2: new Set() }
      const visRec = activeViewRef.current === 'recorridos'
      const token  = mapboxgl.accessToken

      ictusData.features.forEach((feature, i) => {
        const amb = feature.properties.modern_ambulance
        const msu = feature.properties.ambulance_msu

        // Fuentes + capas de ruta
        ROUTES.forEach(({ key, source, layer, color, dash }) => {
          if (!map.getSource(source(i)))
            map.addSource(source(i), { type: 'geojson', data: geojsonLine([]) })
          if (!map.getLayer(layer(i))) {
            const paint = { 'line-color': color, 'line-width': 2 }
            if (dash) paint['line-dasharray'] = [4, 2]
            map.addLayer({ id: layer(i), type: 'line', source: source(i), layout: { visibility: 'none' }, paint })
          }
        })

        // Markers (deduplicados por coordenadas)
        const addMarker = (type, color, coords, name) => {
          const k = coords.join(',')
          if (seen[type].has(k)) return
          seen[type].add(k)
          const marker = new mapboxgl.Marker({ color }).setLngLat(coords).addTo(map)
          marker.getElement().style.display = 'none'
          markersRef.current[type].push({ marker, name })
        }
        addMarker('amb',  'blue',     amb.destiny.coordinates,       amb.destiny.name)
        addMarker('msu',  'green',    msu.first_destiny.coordinates, msu.first_destiny.name)
        if (msu.third_destiny)
          addMarker('msu2', '#9b59b6', msu.third_destiny.coordinates, msu.third_destiny.name)

        // Prefetch rutas en segundo plano
        prefetchRoute(i, 'amb',  [amb.origin.coordinates, amb.destiny.coordinates],              token, map)
        prefetchRoute(i, 'msu',  [msu.origin.coordinates, msu.first_destiny.coordinates],        token, map)
        if (msu.third_destiny)
          prefetchRoute(i, 'msu2', [msu.first_destiny.coordinates, msu.third_destiny.coordinates], token, map)
      })

      // Iconos
      ;[['ambulance-icon', ambulanceSvg], ['ambulance-msu-icon', ambulanceMsuSvg]].forEach(([name, src]) => {
        if (map.hasImage(name)) return
        const img = new Image(20, 20)
        img.onload = () => { if (!map.hasImage(name)) map.addImage(name, img) }
        img.src = src
      })

      // Layers de puntos animados
      ;[
        ['puntos-ambulancias', 'puntos-ambulancias-layer', 'ambulance-icon'],
        ['puntos-msu',          'puntos-msu-layer',         'ambulance-msu-icon'],
        ['puntos-msu2',         'puntos-msu2-layer',        'ambulance-msu-icon'],
      ].forEach(([src, lay, icon]) => {
        if (!map.getSource(src)) map.addSource(src, { type: 'geojson', data: emptyFC() })
        if (!map.getLayer(lay))  map.addLayer({
          id: lay, type: 'symbol', source: src,
          layout: { 'icon-image': icon, 'icon-size': 1, 'icon-allow-overlap': true, visibility: visRec ? 'visible' : 'none' }
        })
      })

      // Capa invisible comarcas
      if (!map.getSource('comarcas-poligons')) map.addSource('comarcas-poligons', { type: 'geojson', data: comarcasData })
      if (!map.getLayer('comarcas-fill-invisible'))
        map.addLayer({ id: 'comarcas-fill-invisible', type: 'fill', source: 'comarcas-poligons', paint: { 'fill-opacity': 0 } })
    }

    if (map.isStyleLoaded()) setup()
    else map.once('load', setup)
    const t = setTimeout(() => { if (map?.isStyleLoaded()) setup() }, 0)

    return () => {
      clearTimeout(t)
      cancelAnimationFrame(rafRef.current)
      ictusData.features.forEach((_, i) =>
        ROUTES.forEach(({ source, layer }) => {
          map.getLayer(layer(i))   && map.removeLayer(layer(i))
          map.getSource(source(i)) && map.removeSource(source(i))
        })
      )
      ;['puntos-ambulancias-layer', 'puntos-msu-layer', 'puntos-msu2-layer', 'comarcas-fill-invisible']
        .forEach(l => map.getLayer(l)  && map.removeLayer(l))
      ;['puntos-ambulancias', 'puntos-msu', 'puntos-msu2', 'comarcas-poligons']
        .forEach(s => map.getSource(s) && map.removeSource(s))
      Object.values(markersRef.current).flat().forEach(({ marker }) => marker.remove())
      markersRef.current = { amb: [], msu: [], msu2: [] }
    }
  }, [map])

  // ── Efecto 2: Visibilidad al cambiar de vista ────────────────────────────
  useEffect(() => {
    if (!map) return
    const on = activeView === 'recorridos'
    if (!on) {
      ;[...activeAmb.current, ...activeMsu.current].forEach(i =>
        ROUTES.forEach(({ layer }) => setVis(map, layer(i), false))
      )
      activeAmb.current.clear()
      activeMsu.current.clear()
      resetDist()
      ;['puntos-ambulancias', 'puntos-msu', 'puntos-msu2'].forEach(s => map.getSource(s)?.setData(emptyFC()))
      Object.values(markersRef.current).flat().forEach(({ marker }) => { marker.getElement().style.display = 'none' })
    }
    ;['puntos-ambulancias-layer', 'puntos-msu-layer', 'puntos-msu2-layer'].forEach(l => setVis(map, l, on))
  }, [activeView, map])

  // ── Efecto 3: Animación RAF ──────────────────────────────────────────────
  useEffect(() => {
    if (!map || activeView !== 'recorridos') return
    let last = performance.now(), vivo = true

    const advance = (type, i, dt) => {
      const line = lines[type][i], len = lengths[type][i]
      if (!line || len < 1e-6) return null
      const d = Math.min(dist.current[type][i] + speeds[type][i] * dt * velocidadRef.current, len)
      dist.current[type][i] = d
      return turf.along(line, d, { units: 'meters' })
    }

    const tick = now => {
      if (!vivo) return
      rafRef.current = requestAnimationFrame(tick)
      if (activeViewRef.current !== 'recorridos' || !isPlayingRef.current) { last = now; return }
      const dt = Math.min((now - last) / 1000, 0.25)
      last = now

      const ptAmb  = [...activeAmb.current].map(i => advance('amb', i, dt)).filter(Boolean)
      const ptMsu  = [...activeMsu.current].map(i => advance('msu', i, dt)).filter(Boolean)
      const ptMsu2 = [...activeMsu.current].map(i => {
        // Solo arranca cuando tramo 1 ha llegado al final
        if (!lines.msu2[i] || dist.current.msu[i] < lengths.msu[i]) return null
        // Primera vez: hacer visible la línea punteada y el marker terciari
        if (map.getLayoutProperty(`ruta-msu2-line-${i}`, 'visibility') === 'none') {
          setVis(map, `ruta-msu2-line-${i}`, true)
          const name = ictusData.features[i].properties.ambulance_msu.third_destiny?.name
          markersRef.current.msu2.forEach(m => { if (m.name === name) m.marker.getElement().style.display = '' })
        }
        return advance('msu2', i, dt)
      }).filter(Boolean)

      map.getSource('puntos-ambulancias')?.setData({ type: 'FeatureCollection', features: ptAmb  })
      map.getSource('puntos-msu')?.setData(        { type: 'FeatureCollection', features: ptMsu  })
      map.getSource('puntos-msu2')?.setData(       { type: 'FeatureCollection', features: ptMsu2 })
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => { vivo = false; cancelAnimationFrame(rafRef.current) }
  }, [map, activeView])

  // ── Efecto 4: Click en comarca ───────────────────────────────────────────
  useEffect(() => {
    if (!map) return

    const onClick = async e => {
      if (activeViewRef.current !== 'recorridos') return
      const [clicked] = map.queryRenderedFeatures(e.point, { layers: ['comarcas-fill-invisible'] })
      if (!clicked) return

      const token = mapboxgl.accessToken

      // Limpiar estado anterior
      ;[...activeAmb.current, ...activeMsu.current].forEach(i => {
        ROUTES.forEach(({ layer }) => setVis(map, layer(i), false))
        dist.current.amb[i] = dist.current.msu[i] = dist.current.msu2[i] = 0
      })
      activeAmb.current.clear()
      activeMsu.current.clear()
      Object.values(markersRef.current).flat().forEach(({ marker }) => { marker.getElement().style.display = 'none' })

      const indices = ictusData.features
        .map((f, i) => normalize(f.properties.region) === normalize(clicked.properties.NOMCOMAR) ? i : -1)
        .filter(i => i !== -1)

      // Esperar rutas (las que no estén ya cacheadas)
      await Promise.all(indices.flatMap(i => {
        const amb = ictusData.features[i].properties.modern_ambulance
        const msu = ictusData.features[i].properties.ambulance_msu
        return [
          ensureRoute(i, 'amb',  [amb.origin.coordinates, amb.destiny.coordinates],              token, map),
          ensureRoute(i, 'msu',  [msu.origin.coordinates, msu.first_destiny.coordinates],        token, map),
          msu.third_destiny
            ? ensureRoute(i, 'msu2', [msu.first_destiny.coordinates, msu.third_destiny.coordinates], token, map)
            : null,
        ].filter(Boolean)
      }))

      const bounds   = []
      const destAmb  = new Set()
      const destMsu  = new Set()

      indices.forEach(i => {
        const amb = ictusData.features[i].properties.modern_ambulance
        const msu = ictusData.features[i].properties.ambulance_msu

        setVis(map, `ruta-line-${i}`, true)
        dist.current.amb[i] = 0
        activeAmb.current.add(i)
        destAmb.add(amb.destiny.name)
        if (lines.amb[i])  bounds.push(...lines.amb[i].geometry.coordinates)

        setVis(map, `ruta-msu-line-${i}`, true)
        dist.current.msu[i] = 0
        activeMsu.current.add(i)
        destMsu.add(msu.first_destiny.name)
        if (lines.msu[i])  bounds.push(...lines.msu[i].geometry.coordinates)

        // Tramo 2 oculto hasta que termina tramo 1; sus coords sí van al bounds
        dist.current.msu2[i] = 0
        if (lines.msu2[i]) bounds.push(...lines.msu2[i].geometry.coordinates)
      })

      if (bounds.length) {
        const b = bounds.reduce((b, c) => b.extend(c), new mapboxgl.LngLatBounds(bounds[0], bounds[0]))
        map.fitBounds(b, { padding: 60, maxZoom: 13, duration: 1500, essential: true })
      }

      // Mostrar markers tramo 1 (tramo 2 se muestra desde el tick)
      markersRef.current.amb.forEach(m  => { if (destAmb.has(m.name))  m.marker.getElement().style.display = '' })
      markersRef.current.msu.forEach(m  => { if (destMsu.has(m.name))  m.marker.getElement().style.display = '' })
    }

    map.on('click', onClick)
    return () => map.off('click', onClick)
  }, [map])

  return null
}
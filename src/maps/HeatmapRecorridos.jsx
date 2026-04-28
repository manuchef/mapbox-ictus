import * as turf from '@turf/turf'
import { useEffect, useLayoutEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import ictusData from '../assets/data/data.json'
import comarcasData from '../assets/data/comarcas.json'
import ambulanceSvg from '../assets/icons/ambulance.svg?url'
import ambulanceMsuSvg from '../assets/icons/ambulance_MSU.svg?url'

// ---------------------------------------------------------------------------
// MAPBOX DIRECTIONS — obtiene la ruta real por carretera entre waypoints
// ---------------------------------------------------------------------------
/**
 * Llama a la API Directions de Mapbox con el perfil driving y devuelve
 * las coordenadas de la geometría decodificada como array [[lng,lat],…].
 *
 * @param {[number,number][]} waypoints  – array de coordenadas [lng, lat]
 * @param {string}            token      – mapboxgl.accessToken
 * @returns {Promise<[number,number][]>} – coordenadas de la ruta real o
 *                                         los waypoints originales si falla
 */
async function fetchDirectionsRoute(waypoints, token) {
  // La API admite máximo 25 waypoints; si hay más, submuestreamos
  const MAX_WP = 25
  let coords = waypoints
  if (coords.length > MAX_WP) {
    const step = Math.ceil(coords.length / (MAX_WP - 2))
    coords = [
      coords[0],
      ...coords.slice(1, -1).filter((_, i) => i % step === 0),
      coords[coords.length - 1]
    ].slice(0, MAX_WP)
  }

  const coordinatesStr = coords.map(([lng, lat]) => `${lng},${lat}`).join(';')
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving/${coordinatesStr}` +
    `?geometries=geojson&overview=full&access_token=${token}`

  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Directions API error: ${res.status}`)
    const data = await res.json()
    if (!data.routes?.length) throw new Error('No routes returned')
    return data.routes[0].geometry.coordinates // [[lng,lat],…]
  } catch (err) {
    console.warn('[HeatmapRecorridos] Directions fallback a línea recta:', err.message)
    return waypoints // fallback: ruta original
  }
}

// ---------------------------------------------------------------------------
// ESTADO GLOBAL DE RUTAS (calculadas una sola vez y cacheadas)
// ---------------------------------------------------------------------------
// Cada entrada: null → aún no calculada, 'loading' → en vuelo, [coords] → lista
const routeCoordsCache = {} // key: `amb-${i}` | `msu-${i}`

// Objetos turf.lineString y métricas (se rellenan cuando la ruta llega)
const routeLines   = new Array(ictusData.features.length).fill(null)
const msuLines     = new Array(ictusData.features.length).fill(null)
const routeLengthsM  = new Array(ictusData.features.length).fill(0)
const msuLengthsM    = new Array(ictusData.features.length).fill(0)
const routeSpeedMps  = new Array(ictusData.features.length).fill(0)
const msuSpeedMps    = new Array(ictusData.features.length).fill(0)

function buildLineMetrics(index, coords, type) {
  if (type === 'amb') {
    routeLines[index]    = turf.lineString(coords)
    routeLengthsM[index] = Math.max(0, turf.length(routeLines[index], { units: 'meters' }))
    const sec = Math.max(Number(ictusData.features[index].properties.modern_ambulance.isochrone_min), 0) * 60 || 600
    routeSpeedMps[index] = routeLengthsM[index] > 1e-6 ? routeLengthsM[index] / sec : 0
  } else {
    msuLines[index]    = turf.lineString(coords)
    msuLengthsM[index] = Math.max(0, turf.length(msuLines[index], { units: 'meters' }))
    const sec = Math.max(Number(ictusData.features[index].properties.ambulance_msu.isochrone_min), 0) * 60 || 600
    msuSpeedMps[index] = msuLengthsM[index] > 1e-6 ? msuLengthsM[index] / sec : 0
  }
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------
const normalize = (str) =>
  str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

const resetDistancias = () => ictusData.features.map(() => 0)

// ---------------------------------------------------------------------------
// COMPONENTE
// ---------------------------------------------------------------------------
export default function HeatmapRecorridos({ map, activeView, isPlaying, velocidad, resetKey }) {
  const activeViewRef = useRef(activeView)
  const isPlayingRef  = useRef(isPlaying)
  const velocidadRef  = useRef(velocidad)

  useLayoutEffect(() => { activeViewRef.current = activeView }, [activeView])
  useLayoutEffect(() => { isPlayingRef.current  = isPlaying  }, [isPlaying])
  useLayoutEffect(() => { velocidadRef.current  = velocidad  }, [velocidad])

  const hospitalMarkersRef = useRef([])
  const msuMarkersRef      = useRef([])

  const distanciaRecorridaRef = useRef(resetDistancias())
  const msuDistanciaRef       = useRef(resetDistancias())

  const rafRef          = useRef(null)
  const activeRoutesRef = useRef(new Set())
  const activeMsuRef    = useRef(new Set())
  const prevVistaRef    = useRef(null)

  // ── reset al entrar en 'recorridos' ──────────────────────────────────────
  useEffect(() => {
    if (activeView === 'recorridos' && prevVistaRef.current !== 'recorridos') {
      distanciaRecorridaRef.current = resetDistancias()
      msuDistanciaRef.current       = resetDistancias()
    }
    prevVistaRef.current = activeView
  }, [activeView])

  useEffect(() => {
    if (!map || activeView !== 'recorridos') return
    distanciaRecorridaRef.current = resetDistancias()
    msuDistanciaRef.current       = resetDistancias()
  }, [resetKey])

  // ── EFECTO 1: CREACIÓN DE CAPAS ──────────────────────────────────────────
  useEffect(() => {
    if (!map) return

    const setupLayers = () => {
      const hospitalesVistos   = new Set()
      const msuDestinosVistos  = new Set()
      const visRec = activeViewRef.current === 'recorridos'
      const token  = mapboxgl.accessToken

      ictusData.features.forEach((feature, index) => {
        const amb = feature.properties.modern_ambulance
        const msu = feature.properties.ambulance_msu

        // ── Fuente vacía para ruta amb (se rellenará con la ruta real) ──
        if (!map.getSource(`ruta-comarca-${index}`)) {
          map.addSource(`ruta-comarca-${index}`, {
            type: 'geojson',
            data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } }
          })
        }
        if (!map.getLayer(`ruta-line-${index}`)) {
          map.addLayer({
            id: `ruta-line-${index}`,
            type: 'line',
            source: `ruta-comarca-${index}`,
            layout: { visibility: 'none' },
            paint: { 'line-color': '#ff0000', 'line-width': 2 }
          })
        }

        // Marker destino ambulancia (azul)
        if (!hospitalesVistos.has(amb.destiny.name)) {
          hospitalesVistos.add(amb.destiny.name)
          const marker = new mapboxgl.Marker({ color: 'blue' })
            .setLngLat(amb.destiny.coordinates)
            .addTo(map)
          marker.getElement().style.display = 'none'
          hospitalMarkersRef.current.push({ marker, destinyName: amb.destiny.name })
        }

        // ── Fuente vacía para ruta MSU ──────────────────────────────────
        if (!map.getSource(`ruta-msu-${index}`)) {
          map.addSource(`ruta-msu-${index}`, {
            type: 'geojson',
            data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } }
          })
        }
        if (!map.getLayer(`ruta-msu-line-${index}`)) {
          map.addLayer({
            id: `ruta-msu-line-${index}`,
            type: 'line',
            source: `ruta-msu-${index}`,
            layout: { visibility: 'none' },
            paint: { 'line-color': '#ff8c00', 'line-width': 2 }
          })
        }

        // Marker destino MSU (verde)
        if (!msuDestinosVistos.has(msu.first_destiny.name)) {
          msuDestinosVistos.add(msu.first_destiny.name)
          const marker = new mapboxgl.Marker({ color: 'green' })
            .setLngLat(msu.first_destiny.coordinates)
            .addTo(map)
          marker.getElement().style.display = 'none'
          msuMarkersRef.current.push({ marker, destinyName: msu.first_destiny.name })
        }

        // ── Pre-fetch de rutas en segundo plano ─────────────────────────
        const ambKey = `amb-${index}`
        if (!routeCoordsCache[ambKey]) {
          routeCoordsCache[ambKey] = 'loading'
          const waypoints = [amb.origin.coordinates, ...amb.rout_coords, amb.destiny.coordinates]
          fetchDirectionsRoute(waypoints, token).then((coords) => {
            routeCoordsCache[ambKey] = coords
            buildLineMetrics(index, coords, 'amb')
            // Actualizar la fuente si ya está en el mapa
            if (map.getSource(`ruta-comarca-${index}`)) {
              map.getSource(`ruta-comarca-${index}`).setData({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: coords }
              })
            }
          })
        }

        const msuKey = `msu-${index}`
        if (!routeCoordsCache[msuKey]) {
          routeCoordsCache[msuKey] = 'loading'
          const waypoints = [msu.origin.coordinates, ...msu.rout_coords, msu.first_destiny.coordinates]
          fetchDirectionsRoute(waypoints, token).then((coords) => {
            routeCoordsCache[msuKey] = coords
            buildLineMetrics(index, coords, 'msu')
            if (map.getSource(`ruta-msu-${index}`)) {
              map.getSource(`ruta-msu-${index}`).setData({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: coords }
              })
            }
          })
        }
      })

      // Iconos ambulancias
      if (!map.hasImage('ambulance-icon')) {
        const img = new Image(20, 20)
        img.onload = () => { if (!map.hasImage('ambulance-icon')) map.addImage('ambulance-icon', img) }
        img.src = ambulanceSvg
      }
      if (!map.hasImage('ambulance-msu-icon')) {
        const img = new Image(20, 20)
        img.onload = () => { if (!map.hasImage('ambulance-msu-icon')) map.addImage('ambulance-msu-icon', img) }
        img.src = ambulanceMsuSvg
      }

      // Source + layer puntos ambulancias
      if (!map.getSource('puntos-ambulancias'))
        map.addSource('puntos-ambulancias', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      if (!map.getLayer('puntos-ambulancias-layer'))
        map.addLayer({
          id: 'puntos-ambulancias-layer',
          type: 'symbol',
          source: 'puntos-ambulancias',
          layout: { 'icon-image': 'ambulance-icon', 'icon-size': 1, 'icon-allow-overlap': true, visibility: visRec ? 'visible' : 'none' }
        })

      // Source + layer puntos MSU
      if (!map.getSource('puntos-msu'))
        map.addSource('puntos-msu', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      if (!map.getLayer('puntos-msu-layer'))
        map.addLayer({
          id: 'puntos-msu-layer',
          type: 'symbol',
          source: 'puntos-msu',
          layout: { 'icon-image': 'ambulance-msu-icon', 'icon-size': 1, 'icon-allow-overlap': true, visibility: visRec ? 'visible' : 'none' }
        })

      // Capa invisible comarcas (clicks)
      if (!map.getSource('comarcas-poligons'))
        map.addSource('comarcas-poligons', { type: 'geojson', data: comarcasData })
      if (!map.getLayer('comarcas-fill-invisible'))
        map.addLayer({
          id: 'comarcas-fill-invisible',
          type: 'fill',
          source: 'comarcas-poligons',
          paint: { 'fill-opacity': 0 }
        })
    }

    if (map.isStyleLoaded()) setupLayers()
    else map.once('load', setupLayers)
    const t = window.setTimeout(() => { if (map?.isStyleLoaded()) setupLayers() }, 0)

    return () => {
      clearTimeout(t)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)

      ictusData.features.forEach((_, i) => {
        if (map.getLayer(`ruta-line-${i}`))     map.removeLayer(`ruta-line-${i}`)
        if (map.getSource(`ruta-comarca-${i}`)) map.removeSource(`ruta-comarca-${i}`)
        if (map.getLayer(`ruta-msu-line-${i}`)) map.removeLayer(`ruta-msu-line-${i}`)
        if (map.getSource(`ruta-msu-${i}`))     map.removeSource(`ruta-msu-${i}`)
      })
      ;['puntos-ambulancias-layer', 'puntos-msu-layer', 'comarcas-fill-invisible']
        .forEach(l => map.getLayer(l)  && map.removeLayer(l))
      ;['puntos-ambulancias', 'puntos-msu', 'comarcas-poligons']
        .forEach(s => map.getSource(s) && map.removeSource(s))

      hospitalMarkersRef.current.forEach(({ marker }) => marker.remove())
      msuMarkersRef.current.forEach(({ marker }) => marker.remove())
      hospitalMarkersRef.current = []
      msuMarkersRef.current = []
    }
  }, [map])

  // ── EFECTO 2: VISIBILIDAD AL CAMBIAR DE VISTA ────────────────────────────
  useEffect(() => {
    if (!map) return
    const mostrar = activeView === 'recorridos'

    if (!mostrar) {
      activeRoutesRef.current.forEach((i) => {
        if (map.getLayer(`ruta-line-${i}`))
          map.setLayoutProperty(`ruta-line-${i}`, 'visibility', 'none')
      })
      activeMsuRef.current.forEach((i) => {
        if (map.getLayer(`ruta-msu-line-${i}`))
          map.setLayoutProperty(`ruta-msu-line-${i}`, 'visibility', 'none')
      })
      activeRoutesRef.current.clear()
      activeMsuRef.current.clear()
      distanciaRecorridaRef.current = resetDistancias()
      msuDistanciaRef.current       = resetDistancias()
      map.getSource('puntos-ambulancias')?.setData({ type: 'FeatureCollection', features: [] })
      map.getSource('puntos-msu')?.setData({ type: 'FeatureCollection', features: [] })
      hospitalMarkersRef.current.forEach(({ marker }) => { marker.getElement().style.display = 'none' })
      msuMarkersRef.current.forEach(({ marker }) => { marker.getElement().style.display = 'none' })
    }

    if (map.getLayer('puntos-ambulancias-layer'))
      map.setLayoutProperty('puntos-ambulancias-layer', 'visibility', mostrar ? 'visible' : 'none')
    if (map.getLayer('puntos-msu-layer'))
      map.setLayoutProperty('puntos-msu-layer', 'visibility', mostrar ? 'visible' : 'none')
  }, [activeView, map])

  // ── EFECTO 3: ANIMACIÓN ──────────────────────────────────────────────────
  useEffect(() => {
    if (!map || activeView !== 'recorridos') return

    let last = performance.now()
    let vivo = true

    const tick = (now) => {
      if (!vivo) return
      rafRef.current = requestAnimationFrame(tick)
      if (activeViewRef.current !== 'recorridos' || !isPlayingRef.current) { last = now; return }

      const dt = Math.min((now - last) / 1000, 0.25)
      last = now

      // Posiciones ambulancias convencionales
      const featuresAmb = [...activeRoutesRef.current].map((i) => {
        if (!routeLines[i]) return null
        const len = routeLengthsM[i]
        if (len < 1e-6) return null
        const d = Math.min(distanciaRecorridaRef.current[i] + routeSpeedMps[i] * dt * velocidadRef.current, len)
        distanciaRecorridaRef.current[i] = d
        return turf.along(routeLines[i], d, { units: 'meters' })
      }).filter(Boolean)

      // Posiciones ambulancias MSU
      const featuresMsu = [...activeMsuRef.current].map((i) => {
        if (!msuLines[i]) return null
        const len = msuLengthsM[i]
        if (len < 1e-6) return null
        const d = Math.min(msuDistanciaRef.current[i] + msuSpeedMps[i] * dt * velocidadRef.current, len)
        msuDistanciaRef.current[i] = d
        return turf.along(msuLines[i], d, { units: 'meters' })
      }).filter(Boolean)

      map.getSource('puntos-ambulancias')?.setData({ type: 'FeatureCollection', features: featuresAmb })
      map.getSource('puntos-msu')?.setData({ type: 'FeatureCollection', features: featuresMsu })
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => { vivo = false; cancelAnimationFrame(rafRef.current) }
  }, [map, activeView])

  // ── EFECTO 4: CLICK EN COMARCA ───────────────────────────────────────────
  useEffect(() => {
    if (!map) return

    const handleMapClick = async (e) => {
      if (activeViewRef.current !== 'recorridos') return

      const [clicked] = map.queryRenderedFeatures(e.point, { layers: ['comarcas-fill-invisible'] })
      if (!clicked) return

      const { NOMCOMAR } = clicked.properties
      const token = mapboxgl.accessToken

      // Limpiar rutas y marcadores anteriores
      activeRoutesRef.current.forEach((i) => {
        if (map.getLayer(`ruta-line-${i}`)) map.setLayoutProperty(`ruta-line-${i}`, 'visibility', 'none')
        distanciaRecorridaRef.current[i] = 0
      })
      activeMsuRef.current.forEach((i) => {
        if (map.getLayer(`ruta-msu-line-${i}`)) map.setLayoutProperty(`ruta-msu-line-${i}`, 'visibility', 'none')
        msuDistanciaRef.current[i] = 0
      })
      activeRoutesRef.current.clear()
      activeMsuRef.current.clear()
      hospitalMarkersRef.current.forEach(({ marker }) => { marker.getElement().style.display = 'none' })
      msuMarkersRef.current.forEach(({ marker }) => { marker.getElement().style.display = 'none' })

      const destinosAmb    = new Set()
      const destinosMsu    = new Set()
      const todasCoordsBounds = []

      // Identificar índices de la comarca clickada
      const indicesComarca = ictusData.features
        .map((feature, i) => normalize(feature.properties.region) === normalize(NOMCOMAR) ? i : -1)
        .filter(i => i !== -1)

      // Para cada comarca, aseguramos que la ruta por carretera esté calculada
      await Promise.all(
        indicesComarca.flatMap((i) => {
          const feature = ictusData.features[i]
          const amb     = feature.properties.modern_ambulance
          const msu     = feature.properties.ambulance_msu
          const promises = []

          // Ambulancia convencional
          const ambKey = `amb-${i}`
          if (!routeCoordsCache[ambKey] || routeCoordsCache[ambKey] === 'loading') {
            // Si aún no está en caché, la pedimos ahora y esperamos
            const waypointsAmb = [amb.origin.coordinates, ...amb.rout_coords, amb.destiny.coordinates]
            const p = fetchDirectionsRoute(waypointsAmb, token).then((coords) => {
              routeCoordsCache[ambKey] = coords
              buildLineMetrics(i, coords, 'amb')
              if (map.getSource(`ruta-comarca-${i}`)) {
                map.getSource(`ruta-comarca-${i}`).setData({
                  type: 'Feature',
                  geometry: { type: 'LineString', coordinates: coords }
                })
              }
            })
            promises.push(p)
          }

          // Ambulancia MSU
          const msuKey = `msu-${i}`
          if (!routeCoordsCache[msuKey] || routeCoordsCache[msuKey] === 'loading') {
            const waypointsMsu = [msu.origin.coordinates, ...msu.rout_coords, msu.first_destiny.coordinates]
            const p = fetchDirectionsRoute(waypointsMsu, token).then((coords) => {
              routeCoordsCache[msuKey] = coords
              buildLineMetrics(i, coords, 'msu')
              if (map.getSource(`ruta-msu-${i}`)) {
                map.getSource(`ruta-msu-${i}`).setData({
                  type: 'Feature',
                  geometry: { type: 'LineString', coordinates: coords }
                })
              }
            })
            promises.push(p)
          }

          return promises
        })
      )

      // Activar capas con las rutas ya listas
      indicesComarca.forEach((i) => {
        const feature = ictusData.features[i]

        if (map.getLayer(`ruta-line-${i}`)) {
          map.setLayoutProperty(`ruta-line-${i}`, 'visibility', 'visible')
          distanciaRecorridaRef.current[i] = 0
          activeRoutesRef.current.add(i)
          destinosAmb.add(feature.properties.modern_ambulance.destiny.name)
          if (routeLines[i]) todasCoordsBounds.push(...routeLines[i].geometry.coordinates)
        }

        if (map.getLayer(`ruta-msu-line-${i}`)) {
          map.setLayoutProperty(`ruta-msu-line-${i}`, 'visibility', 'visible')
          msuDistanciaRef.current[i] = 0
          activeMsuRef.current.add(i)
          destinosMsu.add(feature.properties.ambulance_msu.first_destiny.name)
          if (msuLines[i]) todasCoordsBounds.push(...msuLines[i].geometry.coordinates)
        }
      })

      // Zoom a las rutas activas
      if (todasCoordsBounds.length) {
        const bounds = todasCoordsBounds.reduce(
          (b, c) => b.extend(c),
          new mapboxgl.LngLatBounds(todasCoordsBounds[0], todasCoordsBounds[0])
        )
        map.fitBounds(bounds, { padding: 60, maxZoom: 13, duration: 1500, essential: true })
      }

      // Mostrar markers
      hospitalMarkersRef.current.forEach(({ marker, destinyName }) => {
        if (destinosAmb.has(destinyName)) marker.getElement().style.display = ''
      })
      msuMarkersRef.current.forEach(({ marker, destinyName }) => {
        if (destinosMsu.has(destinyName)) marker.getElement().style.display = ''
      })
    }

    map.on('click', handleMapClick)
    return () => map.off('click', handleMapClick)
  }, [map])

  return null
}
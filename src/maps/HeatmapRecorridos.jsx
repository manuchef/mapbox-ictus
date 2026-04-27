import * as turf from '@turf/turf'
import { useEffect, useLayoutEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import ictusData from '../assets/data/data.json'
import comarcasData from '../assets/data/comarcas.json'
import ambulanceSvg from '../assets/icons/ambulance.svg?url'

const routeLines = ictusData.features.map((feature) => {
  const amb = feature.properties.modern_ambulance
  return turf.lineString([
    amb.origin.coordinates,
    ...amb.rout_coords,
    amb.destiny.coordinates
  ])
})

const routeLengthsM = routeLines.map((line) =>
  Math.max(0, turf.length(line, { units: 'meters' }))
)

const routeSpeedMps = ictusData.features.map((f, index) => {
  const min = Number(f.properties.modern_ambulance.isochrone_min)
  const len = routeLengthsM[index]
  const sec = min > 0 ? min * 60 : 600
  return len > 1e-6 ? len / sec : 0
})

export default function HeatmapRecorridos({ map, activeView, isPlaying, velocidad, resetKey }) {
  const activeViewRef = useRef(activeView)
  useLayoutEffect(() => { activeViewRef.current = activeView }, [activeView])

  const isPlayingRef = useRef(isPlaying)
  useLayoutEffect(() => { isPlayingRef.current = isPlaying }, [isPlaying])

  const velocidadRef = useRef(velocidad)
  useLayoutEffect(() => { velocidadRef.current = velocidad }, [velocidad])

  const hospitalMarkersRef = useRef([]) // array de { marker, destinyName }
  const distanciaRecorridaRef = useRef(routeLines.map(() => 0))
  const rafRef = useRef(null)
  const activeRoutesRef = useRef(new Set())

  const prevVistaRef = useRef(null)
  useEffect(() => {
    if (activeView === 'recorridos' && prevVistaRef.current !== 'recorridos') {
      distanciaRecorridaRef.current = routeLines.map(() => 0)
    }
    prevVistaRef.current = activeView
  }, [activeView])

  useEffect(() => {
    if (!map || activeView !== 'recorridos') return
    distanciaRecorridaRef.current = routeLines.map(() => 0)
  }, [resetKey])

  // --- EFECTO 1: CREACIÓN DE CAPAS ---
  useEffect(() => {
    if (!map) return

    const setupLayers = () => {
      const hospitalesVistos = new Set()
      const visRec = activeViewRef.current === 'recorridos'

      ictusData.features.forEach((feature, index) => {
        const amb = feature.properties.modern_ambulance
        const sourceId = `ruta-comarca-${index}`
        const layerId = `ruta-line-${index}`

        if (!map.getSource(sourceId)) {
          map.addSource(sourceId, {
            type: 'geojson',
            data: {
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: [amb.origin.coordinates, ...amb.rout_coords, amb.destiny.coordinates]
              }
            }
          })
        }
        if (!map.getLayer(layerId)) {
          map.addLayer({
            id: layerId,
            type: 'line',
            source: sourceId,
            layout: { visibility: 'none' },
            paint: { 'line-color': '#ff0000', 'line-width': 2 }
          })
        }

        const hospitalKey = amb.destiny.name
        if (!hospitalesVistos.has(hospitalKey)) {
          hospitalesVistos.add(hospitalKey)
          const markerDesti = new mapboxgl.Marker({ color: 'blue' })
            .setLngLat(amb.destiny.coordinates)
            .addTo(map)

          // Ocultos por defecto, igual que las rutas
          markerDesti.getElement().style.display = 'none'

          // Guardamos el marcador junto a su nombre de hospital
          hospitalMarkersRef.current.push({
            marker: markerDesti,
            destinyName: hospitalKey
          })
        }
      })

      if (!map.hasImage('ambulance-icon')) {
        const img = new Image(20, 20)
        img.onload = () => {
          if (!map.hasImage('ambulance-icon')) map.addImage('ambulance-icon', img)
        }
        img.src = ambulanceSvg
      }

      if (!map.getSource('puntos-ambulancias')) {
        map.addSource('puntos-ambulancias', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] }
        })
      }

      if (!map.getLayer('puntos-ambulancias-layer')) {
        map.addLayer({
          id: 'puntos-ambulancias-layer',
          type: 'symbol',
          source: 'puntos-ambulancias',
          layout: {
            'icon-image': 'ambulance-icon',
            'icon-size': 1,
            'icon-allow-overlap': true,
            visibility: visRec ? 'visible' : 'none'
          }
        })
      }

      if (!map.getSource('comarcas-poligons')) {
        map.addSource('comarcas-poligons', { type: 'geojson', data: comarcasData })
      }
      if (!map.getLayer('comarcas-fill-invisible')) {
        map.addLayer({
          id: 'comarcas-fill-invisible',
          type: 'fill',
          source: 'comarcas-poligons',
          paint: { 'fill-opacity': 0 }
        })
      }
    }

    if (map.isStyleLoaded()) setupLayers()
    else map.once('load', setupLayers)

    const t = window.setTimeout(() => {
      if (map?.isStyleLoaded()) setupLayers()
    }, 0)

    return () => {
      clearTimeout(t)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      ictusData.features.forEach((_, index) => {
        if (map.getLayer(`ruta-line-${index}`)) map.removeLayer(`ruta-line-${index}`)
        if (map.getSource(`ruta-comarca-${index}`)) map.removeSource(`ruta-comarca-${index}`)
      })
      if (map.getLayer('puntos-ambulancias-layer')) map.removeLayer('puntos-ambulancias-layer')
      if (map.getSource('puntos-ambulancias')) map.removeSource('puntos-ambulancias')
      hospitalMarkersRef.current.forEach(({ marker }) => marker.remove())
      hospitalMarkersRef.current = []
      if (map.getLayer('comarcas-fill-invisible')) map.removeLayer('comarcas-fill-invisible')
      if (map.getSource('comarcas-poligons')) map.removeSource('comarcas-poligons')
    }
  }, [map])

  // --- EFECTO 2: VISIBILIDAD AL CAMBIAR DE VISTA ---
  useEffect(() => {
    if (!map) return
    const mostrar = activeView === 'recorridos'

    if (!mostrar) {
      activeRoutesRef.current.forEach((index) => {
        if (map.getLayer(`ruta-line-${index}`)) {
          map.setLayoutProperty(`ruta-line-${index}`, 'visibility', 'none')
        }
      })
      activeRoutesRef.current.clear()
      distanciaRecorridaRef.current = routeLines.map(() => 0)
      map.getSource('puntos-ambulancias')?.setData({ type: 'FeatureCollection', features: [] })
      // Ocultar todos los marcadores azules al salir de la vista
      hospitalMarkersRef.current.forEach(({ marker }) => {
        marker.getElement().style.display = 'none'
      })
    }

    if (map.getLayer('puntos-ambulancias-layer')) {
      map.setLayoutProperty('puntos-ambulancias-layer', 'visibility', mostrar ? 'visible' : 'none')
    }
  }, [activeView, map])

  // --- EFECTO 3: ANIMACIÓN ---
  useEffect(() => {
    if (!map || activeView !== 'recorridos') return

    let last = performance.now()
    let vivo = true

    const tick = (now) => {
      if (!vivo) return
      rafRef.current = requestAnimationFrame(tick)
      if (activeViewRef.current !== 'recorridos') return
      if (!isPlayingRef.current) { last = now; return }

      const dt = Math.min((now - last) / 1000, 0.25)
      last = now

      const features = [...activeRoutesRef.current].map((index) => {
        const line = routeLines[index]
        const len = routeLengthsM[index]
        if (len < 1e-6) return null

        const v = routeSpeedMps[index]
        let d = distanciaRecorridaRef.current[index] + v * dt * velocidadRef.current
        if (d > len) d = len
        distanciaRecorridaRef.current[index] = d

        return turf.along(line, d, { units: 'meters' })
      }).filter(Boolean)

      map.getSource('puntos-ambulancias')?.setData({
        type: 'FeatureCollection',
        features
      })
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      vivo = false
      cancelAnimationFrame(rafRef.current)
    }
  }, [map, activeView])

  // --- EFECTO 4: CLICK → fitBounds + mostrar solo ruta y marcador de esa comarca ---
  useEffect(() => {
    if (!map) return

    const normalize = (str) =>
      str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

    const handleMapClick = (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ['comarcas-fill-invisible'] })
      if (!features.length) return

      const comarcaName = features[0].properties.NOMCOMAR
      const geometry = features[0].geometry

      // fitBounds
      let coords = []
      if (geometry.type === 'Polygon') coords = geometry.coordinates[0]
      else if (geometry.type === 'MultiPolygon') coords = geometry.coordinates.flat(2)
      if (!coords.length) return

      const bounds = new mapboxgl.LngLatBounds(coords[0], coords[0])
      coords.forEach((c) => bounds.extend(c))
      map.fitBounds(bounds, { padding: 60, maxZoom: 13, duration: 1500, essential: true })

      // Ocultar todas las rutas anteriores
      activeRoutesRef.current.forEach((index) => {
        if (map.getLayer(`ruta-line-${index}`)) {
          map.setLayoutProperty(`ruta-line-${index}`, 'visibility', 'none')
        }
        distanciaRecorridaRef.current[index] = 0
      })
      activeRoutesRef.current.clear()

      // Ocultar todos los marcadores azules
      hospitalMarkersRef.current.forEach(({ marker }) => {
        marker.getElement().style.display = 'none'
      })

      // Recoger los hospitales de destino de esta comarca
      const destinosDeEstaComarca = new Set()
      ictusData.features.forEach((feature, index) => {
        if (normalize(feature.properties.region) !== normalize(comarcaName)) return
        if (!map.getLayer(`ruta-line-${index}`)) return

        map.setLayoutProperty(`ruta-line-${index}`, 'visibility', 'visible')
        distanciaRecorridaRef.current[index] = 0
        activeRoutesRef.current.add(index)

        // Guardar el hospital destino de esta ruta
        destinosDeEstaComarca.add(feature.properties.modern_ambulance.destiny.name)
      })

      // Mostrar solo los marcadores azules de los hospitales destino de esta comarca
      hospitalMarkersRef.current.forEach(({ marker, destinyName }) => {
        if (destinosDeEstaComarca.has(destinyName)) {
          marker.getElement().style.display = ''
        }
      })
    }

    map.on('click', handleMapClick)
    return () => map.off('click', handleMapClick)
  }, [map])

  return null
}
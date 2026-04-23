import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import ictusData from '../assets/data/data.json'

export default function HeatmapRecorridos({ map, activeView }) {
  const activeViewRef = useRef(activeView)
  useEffect(() => {
    activeViewRef.current = activeView
  }, [activeView])

  const markersRef = useRef([])

  useEffect(() => {
    if (!map) return

    const setupLayers = () => {
      const hospitalesVistos = new Set()
      const vis = activeViewRef.current === 'recorridos' ? 'visible' : 'none'

      ictusData.features.forEach((feature, index) => {
        const amb = feature.properties.ambulancia_actual
        if (!amb?.origen?.coords || !amb?.desti?.coords) return
        const sourceId = `ruta-comarca-${index}`
        const layerId = `ruta-line-${index}`

        if (!map.getSource(sourceId)) {
          map.addSource(sourceId, {
            type: 'geojson',
            data: {
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: [amb.origen.coords, amb.desti.coords]
              }
            }
          })
        }

        const hadLineLayer = !!map.getLayer(layerId)
        if (!hadLineLayer) {
          map.addLayer({
            id: layerId,
            type: 'line',
            source: sourceId,
            layout: { visibility: vis },
            paint: {
              'line-color': '#ff0000',
              'line-width': 2
            }
          })
        }

        if (hadLineLayer) {
          return
        }

        const markerOrigen = new mapboxgl.Marker({ color: 'green' })
          .setLngLat(amb.origen.coords)
          .addTo(map)
        markersRef.current.push(markerOrigen)

        const hospitalKey = amb.desti.nom
        if (!hospitalesVistos.has(hospitalKey)) {
          hospitalesVistos.add(hospitalKey)
          const markerDesti = new mapboxgl.Marker({ color: 'blue' })
            .setLngLat(amb.desti.coords)
            .addTo(map)
          markersRef.current.push(markerDesti)
        }
      })
    }

    const runSetup = () => {
      if (!map) return
      setupLayers()
    }

    if (map.isStyleLoaded()) {
      runSetup()
    } else {
      map.once('load', runSetup)
    }
    const t = window.setTimeout(() => {
      if (map?.isStyleLoaded()) {
        runSetup()
      }
    }, 0)

    return () => {
      clearTimeout(t)
      ictusData.features.forEach((_, index) => {
        const sourceId = `ruta-comarca-${index}`
        const layerId = `ruta-line-${index}`
        if (map?.getLayer(layerId)) map.removeLayer(layerId)
        if (map?.getSource(sourceId)) map.removeSource(sourceId)
      })
      markersRef.current.forEach(m => m.remove())
      markersRef.current = []
    }
  }, [map])

  useEffect(() => {
    if (!map) return
    const vis = activeView === 'recorridos' ? 'visible' : 'none'
    ictusData.features.forEach((_, index) => {
      const id = `ruta-line-${index}`
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', vis)
      }
    })
    markersRef.current.forEach(m => {
      const el = m.getElement()
      if (el) el.style.display = vis === 'visible' ? '' : 'none'
    })
  }, [activeView, map])

  return null
}

import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import ictusData from '../assets/data/data.json'

export default function HeatmapRecorridos({ map, activeView }) {
  const markersRef = useRef([])

  useEffect(() => {
    if (!map.current) return

    const setupLayers = () => {
  const hospitalesVistos = new Set() // ← para no repetir marcadores azules

  ictusData.features.forEach((feature, index) => {
    const amb = feature.properties.ambulancia_actual
    const sourceId = `ruta-comarca-${index}`
    const layerId = `ruta-line-${index}`

    if (!map.current.getSource(sourceId)) {
      map.current.addSource(sourceId, {
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

    if (!map.current.getLayer(layerId)) {
      map.current.addLayer({
        id: layerId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': '#ff0000',
          'line-width': 2
        }
      })
    }

    // Marcador verde por cada centro asistencial (origen) — siempre único
    const markerOrigen = new mapboxgl.Marker({ color: 'green' })
      .setLngLat(amb.origen.coords)
      .addTo(map.current)
    markersRef.current.push(markerOrigen)

    // Marcador azul solo si este hospital no se ha pintado ya
    const hospitalKey = amb.desti.nom
    if (!hospitalesVistos.has(hospitalKey)) {
      hospitalesVistos.add(hospitalKey)
      const markerDesti = new mapboxgl.Marker({ color: 'blue' })
        .setLngLat(amb.desti.coords)
        .addTo(map.current)
      markersRef.current.push(markerDesti)
    }
  })
}

    if (map.current.isStyleLoaded()) setupLayers()
    else map.current.on('load', setupLayers)

    return () => {
      ictusData.features.forEach((_, index) => {
        const sourceId = `ruta-comarca-${index}`
        const layerId = `ruta-line-${index}`
        if (map.current.getLayer(layerId)) map.current.removeLayer(layerId)
        if (map.current.getSource(sourceId)) map.current.removeSource(sourceId)
      })
      markersRef.current.forEach(m => m.remove())
      markersRef.current = []
    }
  }, [map])

  return null
}
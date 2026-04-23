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
    const sourceId = `ruta-comarca-${index}`
    const layerId = `ruta-line-${index}`
    const pointsourceId = `puntos-comarca-${index}`
    const pointLayerId = `puntos-line-${index}`

        if (!map.getSource(sourceId)) {
          map.addSource(sourceId, {
            type: 'geojson',
            data: {
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: [
                  amb.origen.coords, 
                  ...amb.ruta_coords,
                  amb.desti.coords
                ]
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

    if (!map.current.getLayer(layerId)) {
      map.current.addLayer({
        id: layerId,
        type: 'line',
        source: sourceId,
        layout: {
          'visibility': activeView === 'recorridos' ? 'visible' : 'none'
        },
        paint: {
          'line-color': '#ff0000',
          'line-width': 2
        }
      })
    }

    if (map.isStyleLoaded()) {
      runSetup()
    } else {
      map.once('load', runSetup)
    }
    if (!map.current.getSource(pointsourceId)) {
      map.current.addSource(pointsourceId, {
        type: 'geojson',
        data: {
         type: 'Feature',
          geometry: { 
            type: 'Point',
            coordinates: amb.origen.coords
          }
        }
      })
    }
    
    if (!map.current.getLayer(pointLayerId)) {
      map.current.addLayer({
        id: pointLayerId,
        type: 'circle',
        source: pointsourceId,
        layout: {
          'visibility': activeView === 'recorridos' ? 'visible' : 'none'
        },
        paint: {
          'circle-radius': 6,
          'circle-color': '#00ff00'
        }
      })
    }
              


    // Marcador azul solo si este hospital no se ha pintado ya
    const hospitalKey = amb.desti.nom
    if (!hospitalesVistos.has(hospitalKey)) {
      hospitalesVistos.add(hospitalKey)
      const markerDesti = new mapboxgl.Marker({ color: 'blue' })
        .setLngLat(amb.desti.coords)
        .addTo(map.current)
      markersRef.current.push(markerDesti)
      markerDesti.getElement().style.display = activeView === 'recorridos' ? '' : 'none'
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
        const pointsourceId = `puntos-comarca-${index}`
        const pointLayerId = `puntos-line-${index}`
        if (map.current.getLayer(layerId)) map.current.removeLayer(layerId)
        if (map.current.getSource(sourceId)) map.current.removeSource(sourceId)
        if (map.current.getLayer(pointLayerId)) map.current.removeLayer(pointLayerId)
        if (map.current.getSource(pointsourceId)) map.current.removeSource(pointsourceId)
      })
      markersRef.current.forEach(m => m.remove())
      markersRef.current = []
    }
  }, [map])

  useEffect(() => {
    if (!map) return

    const isVisible = activeView === 'recorridos'

    ictusData.features.forEach((_, index) => {
      const layerId = `ruta-line-${index}`
      const pointLayerId = `puntos-line-${index}`
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', isVisible ? 'visible' : 'none')
      }
      if (map.getLayer(pointLayerId)) {
        map.setLayoutProperty(pointLayerId, 'visibility', isVisible ? 'visible' : 'none')
      }

      markersRef.current.forEach(marker => {
        const el = marker.getElement()
        el.style.display = isVisible ? '' : 'none'
      })
    })
   }, [activeView, map])

  return null
}

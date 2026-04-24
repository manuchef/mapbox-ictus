import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import comarcasData from '../assets/data/comarcas.json'
import ictusData from '../assets/data/data.json'

export default function HeatmapBurbuja({ map, activeView }) {
  const activeViewRef = useRef(activeView)
  useEffect(() => {
    activeViewRef.current = activeView
  }, [activeView])

  const tooltip = useRef(new mapboxgl.Popup({
    closeButton: false,
    closeOnClick: false
  }))

  // --- EFECTO 1: CREACIÓN DE CAPAS (Solo una vez) ---
  useEffect(() => {
    if (!map) return

    const lookup = {}
    ictusData.features.forEach(f => { lookup[f.properties.region] = f.properties })

    comarcasData.features.forEach(f => {
      const datos = lookup[f.properties.NOMCOMAR] || lookup[f.properties.NOM_COMARCA]
      if (datos) {
        f.properties.cases_stroke_an = datos.cases_stroke_an
        f.properties.population = datos.population
      }
    })

    const ictusGeoJSONPoints = {
      type: 'FeatureCollection',
      features: ictusData.features.map(f => ({
        type: 'Feature',
        properties: {
          cases_stroke_an: f.properties.cases_stroke_an,
          comarca: f.properties.region,
        },
        geometry: {
          type: 'Point',
          coordinates: f.geometry.coordinates  
        }
      }))
    }

    const setupLayers = () => {
      if (!map) return
      if (map.getLayer('ictus-burbujas')) return

      if (!map.getSource('comarcas')) {
        map.addSource('comarcas', {
          type: 'geojson',
          data: comarcasData    
        })
      }

      if (!map.getSource('data_ictus')) {
        map.addSource('data_ictus', { type: 'geojson', data: ictusGeoJSONPoints })
      }

      const v = activeViewRef.current
      map.addLayer({
        id: 'ictus-burbujas',
        type: 'circle',
        source: 'data_ictus',
        layout: {
          'visibility': v === 'burbujas' ? 'visible' : 'none',
        },
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['get', 'cases_stroke_an'],
            0, 6,
            50, 12,
            100, 20,
            200, 32,
            400, 50
          ],
          'circle-color': [
            'interpolate', ['linear'], ['get', 'cases_stroke_an'],
            0, '#90E0EF',
            50, '#0077B6',
            100, '#FFD60A',
            200, '#FF8C00',
            400, '#D00000'
          ],
          'circle-opacity': 0.8,
          'circle-stroke-color': 'white',
          'circle-stroke-width': 1.5
        }
      })

      map.addLayer({
        id: 'comarcas-interaction-burbujas',
        type: 'fill',
        source: 'comarcas',
        paint: { 'fill-color': 'rgba(0,0,0,0)' },
        layout: {
          'visibility': v === 'burbujas' ? 'visible' : 'none',
        },
      })

      map.on('mousemove', 'comarcas-interaction-burbujas', handleMouseMove)
      map.on('mouseleave', 'comarcas-interaction-burbujas', handleMouseLeave)
    }

    const handleMouseMove = (e) => {
        if (e.features.length > 0) {
            map.getCanvas().style.cursor = 'pointer'
            const { NOMCOMAR, cases_stroke_an, population } = e.features[0].properties
            tooltip.current
            .setLngLat(e.lngLat)
            .setHTML(`
                <div style="padding:5px">
                <strong>${NOMCOMAR || 'Comarca'}</strong><br/>
                Población: ${population || 'N/A'}<br/>
                Casos ictus: <span style="color:#D00000; font-weight:bold">${cases_stroke_an || 0}</span>
                </div>
            `)
            .addTo(map)
        }
    }

    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = ''
      tooltip.current.remove()
    }

    const runSetup = () => {
      if (!map) return
      if (map.getLayer('ictus-burbujas')) return
      setupLayers()
    }

    if (map.isStyleLoaded()) {
      runSetup()
    } else {
      map.once('load', runSetup)
    }
    const t = window.setTimeout(() => {
      if (map?.isStyleLoaded() && !map.getLayer('ictus-burbujas')) {
        runSetup()
      }
    }, 0)

    return () => {
      clearTimeout(t)
      if (map) {
        if (map.getLayer('ictus-burbujas')) map.removeLayer('ictus-burbujas')
        if (map.getLayer('comarcas-interaction-burbujas')) map.removeLayer('comarcas-interaction-burbujas')
        if (map.getSource('data_ictus')) map.removeSource('data_ictus')
        if (map.getSource('comarcas')) map.removeSource('comarcas')
        map.off('mousemove', 'comarcas-interaction-burbujas', handleMouseMove)
        map.off('mouseleave', 'comarcas-interaction-burbujas', handleMouseLeave)
      }
    }
  }, [map])

  // --- EFECTO 2: ACTUALIZAR VISIBILIDAD (Cuando activeView cambie) ---
  useEffect(() => {
    if (!map) return

    const updateVisibility = () => {
      if (!map.getLayer('ictus-burbujas')) return
      const vis = activeView === 'burbujas' ? 'visible' : 'none'
      map.setLayoutProperty('ictus-burbujas', 'visibility', vis)
      map.setLayoutProperty('comarcas-interaction-burbujas', 'visibility', vis)
    }

    updateVisibility()
    const t0 = window.setTimeout(updateVisibility, 0)
    const t1 = window.setTimeout(updateVisibility, 100)
    const raf = requestAnimationFrame(() => {
      if (map) updateVisibility()
    })
    return () => {
      clearTimeout(t0)
      clearTimeout(t1)
      cancelAnimationFrame(raf)
    }
  }, [activeView, map])

  return null
}

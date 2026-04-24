import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import comarcasData from '../assets/data/comarcas.json'
import ictusData from '../assets/data/data.json'

export default function HeatmapCasos({ map, activeView }) {
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
          comarca: f.properties.region
        },
        geometry: {
          type: 'Point',
          coordinates: f.geometry.coordinates
        }
      }))
    }

    const setupLayers = () => {
      if (!map) return
      if (map.getLayer('ictus-heat')) return

      if (!map.getSource('data_ictus')) {
        map.addSource('data_ictus', { type: 'geojson', data: ictusGeoJSONPoints })
      }

      const v = activeViewRef.current
      map.addLayer({
        id: 'ictus-heat',
        type: 'heatmap',
        source: 'data_ictus',
        layout: {
          'visibility': v === 'heatmap' ? 'visible' : 'none',
        },
        paint: {
          'heatmap-weight': ['interpolate', ['linear'], ['get', 'cases_stroke_an'], 0, 0, 100, 1],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 9, 3],
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0,0,0,0)', 0.2, '#0077B6', 0.4, '#90E0EF', 0.6, '#FFD60A', 0.8, '#FF8C00', 1, '#D00000'
          ],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 20, 7, 50, 12, 100],
          'heatmap-opacity': 0.8
        }
      })

      map.addLayer({
        id: 'comarcas-interaction',
        type: 'fill',
        source: 'comarcas',
        paint: { 'fill-color': 'rgba(0,0,0,0)' },
        layout: {
          'visibility': v === 'heatmap' ? 'visible' : 'none',
        },
      })

      map.on('mousemove', 'comarcas-interaction', handleMouseMove)
      map.on('mouseleave', 'comarcas-interaction', handleMouseLeave)
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
      if (map.getLayer('ictus-heat')) return
      setupLayers()
    }

    if (map.isStyleLoaded()) {
      runSetup()
    } else {
      map.once('load', runSetup)
    }
    const t = window.setTimeout(() => {
      if (map?.isStyleLoaded() && !map.getLayer('ictus-heat')) {
        runSetup()
      }
    }, 0)

    return () => {
      clearTimeout(t)
      if (map) {
        if (map.getLayer('ictus-heat')) map.removeLayer('ictus-heat')
        if (map.getLayer('comarcas-interaction')) map.removeLayer('comarcas-interaction')
        if (map.getLayer('comarcas-line')) map.removeLayer('comarcas-line')
        if (map.getSource('comarcas')) map.removeSource('comarcas')
        if (map.getSource('data_ictus')) map.removeSource('data_ictus')
        map.off('mousemove', 'comarcas-interaction', handleMouseMove)
        map.off('mouseleave', 'comarcas-interaction', handleMouseLeave)
      }
    }
  }, [map])


  // --- EFECTO 2: ACTUALIZAR VISIBILIDAD (Cuando activeView cambie) ---
  useEffect(() => {
    if (!map) return

    const updateVisibility = () => {
      if (!map.getLayer('ictus-heat')) return
      const vis = activeView === 'heatmap' ? 'visible' : 'none'
      map.setLayoutProperty('ictus-heat', 'visibility', vis)
      map.setLayoutProperty('comarcas-interaction', 'visibility', vis)
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
  }, [activeView, map]) // Este efecto escucha los cambios de activeView

  return null
}

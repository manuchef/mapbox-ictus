import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import comarcasData from '../assets/data/comarcas.json'
import ictusData from '../assets/data/data.json'

export default function HeatmapBurbuja({ map, activeView }) {
  const tooltip = useRef(new mapboxgl.Popup({
    closeButton: false,
    closeOnClick: false
  }))

  // --- EFECTO 1: CREACIÓN DE CAPAS (Solo una vez) ---
  useEffect(() => {
    if (!map.current) return

    const lookup = {}
    ictusData.features.forEach(f => { lookup[f.properties.comarca] = f.properties })

    comarcasData.features.forEach(f => {
      const datos = lookup[f.properties.NOMCOMAR] || lookup[f.properties.NOM_COMARCA]
      if (datos) {
        f.properties.casos_ictus = datos.casos_ictus_any
        f.properties.poblacio = datos.poblacio
      }
    })

    const ictusGeoJSONPoints = {
      type: 'FeatureCollection',
      features: ictusData.features.map(f => ({
        type: 'Feature',
        properties: {
          casos_ictus: f.properties.casos_ictus_any,
          comarca: f.properties.comarca,
        },
        geometry: {
          type: 'Point',
          coordinates: f.geometry.coordinates  
        }
      }))
    }

    const setupLayers = () => {
      if (!map.current.getSource('comarcas')) {
        map.current.addSource('comarcas', {
          type: 'geojson',
          data: comarcasData    
        })
      }

      if (!map.current.getSource('data_ictus')) {
        map.current.addSource('data_ictus', { type: 'geojson', data: ictusGeoJSONPoints })
      }

      // CAPA BURBUJAS
      map.current.addLayer({
        id: 'ictus-burbujas',
        type: 'circle',
        source: 'data_ictus',
        layout: {
          'visibility': activeView === 'burbujas' ? 'visible' : 'none'
        },
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['get', 'casos_ictus'],
            0, 6,
            50, 12,
            100, 20,
            200, 32,
            400, 50
          ],
          'circle-color': [
            'interpolate', ['linear'], ['get', 'casos_ictus'],
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

      map.current.addLayer({
        id: 'comarcas-interaction-burbujas',
        type: 'fill',
        source: 'comarcas',
        paint: { 'fill-color': 'rgba(0,0,0,0)' },
        layout: {
          'visibility': activeView === 'burbujas' ? 'visible' : 'none'
        },
      })

      map.current.on('mousemove', 'comarcas-interaction-burbujas', handleMouseMove)
      map.current.on('mouseleave', 'comarcas-interaction-burbujas', handleMouseLeave)
    }

    const handleMouseMove = (e) => {
        if (e.features.length > 0) {
            map.current.getCanvas().style.cursor = 'pointer'
            const { NOMCOMAR, casos_ictus, poblacio } = e.features[0].properties
            tooltip.current
            .setLngLat(e.lngLat)
            .setHTML(`
                <div style="padding:5px">
                <strong>${NOMCOMAR || 'Comarca'}</strong><br/>
                Població: ${poblacio || 'N/A'}<br/>
                Casos ictus: <span style="color:#D00000; font-weight:bold">${casos_ictus || 0}</span>
                </div>
            `)
            .addTo(map.current)
        }
    }

    const handleMouseLeave = () => {
      map.current.getCanvas().style.cursor = ''
      tooltip.current.remove()
    }

    if (map.current.isStyleLoaded()) setupLayers()
    else map.current.on('load', setupLayers)

    return () => {
      if (map.current) {
        if (map.current.getLayer('ictus-burbujas')) map.current.removeLayer('ictus-burbujas')
        if (map.current.getLayer('comarcas-interaction-burbujas')) map.current.removeLayer('comarcas-interaction-burbujas')
        if (map.current.getSource('data_ictus')) map.current.removeSource('data_ictus')
        if (map.current.getSource('comarcas')) map.current.removeSource('comarcas')
        map.current.off('mousemove', 'comarcas-interaction-burbujas', handleMouseMove)
        map.current.off('mouseleave', 'comarcas-interaction-burbujas', handleMouseLeave)
      }
    }
  }, [map])

  // --- EFECTO 2: ACTUALIZAR VISIBILIDAD (Cuando activeView cambie) ---
  useEffect(() => {
    if (!map.current) return

    // Función para actualizar la propiedad de visibilidad en Mapbox
    const updateVisibility = () => {
      if (map.current.getLayer('ictus-burbujas')) {
        map.current.setLayoutProperty(
          'ictus-burbujas',
          'visibility',
          activeView === 'burbujas' ? 'visible' : 'none'
        )
        map.current.setLayoutProperty(
          'comarcas-interaction-burbujas',
          'visibility',
          activeView === 'burbujas' ? 'visible' : 'none'
        )
      }
    }

    // Si el estilo ya cargó, actualizamos. Si no, esperamos a que cargue.
    if (map.current.isStyleLoaded()) {
      updateVisibility();
    } else {
      map.current.once('idle', updateVisibility);
    }

  }, [activeView, map])

  return null
}
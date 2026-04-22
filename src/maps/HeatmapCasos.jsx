import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import comarcasData from '../assets/data/comarcas.json'
import ictusData from '../assets/data/data.json'

export default function HeatmapCasos({ map, activeView }) {
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
          comarca: f.properties.comarca
        },
        geometry: {
          type: 'Point',
          coordinates: f.geometry.coordinates
        }
      }))
    }

    const setupLayers = () => {
      if (!map.current.getSource('data_ictus')) {
        map.current.addSource('data_ictus', { type: 'geojson', data: ictusGeoJSONPoints })
      }

      // CAPA HEATMAP
      map.current.addLayer({
        id: 'ictus-heat',
        type: 'heatmap',
        source: 'data_ictus',
        layout: {
          // Importante: usamos el valor inicial de activeView
          'visibility': activeView === 'heatmap' ? 'visible' : 'none'
        },
        paint: {
          'heatmap-weight': ['interpolate', ['linear'], ['get', 'casos_ictus'], 0, 0, 100, 1],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 9, 3],
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0,0,0,0)', 0.2, '#0077B6', 0.4, '#90E0EF', 0.6, '#FFD60A', 0.8, '#FF8C00', 1, '#D00000'
          ],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 20, 7, 50, 12, 100],
          'heatmap-opacity': 0.8
        }
      })

      map.current.addLayer({
        id: 'comarcas-interaction',
        type: 'fill',
        source: 'comarcas',
        paint: { 'fill-color': 'rgba(0,0,0,0)' },
        layout: {
          // Importante: usamos el valor inicial de activeView
          'visibility': activeView === 'heatmap' ? 'visible' : 'none'
        },
      })

      // Eventos
      map.current.on('mousemove', 'comarcas-interaction', handleMouseMove)
      map.current.on('mouseleave', 'comarcas-interaction', handleMouseLeave)
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
        if (map.current.getLayer('ictus-heat')) map.current.removeLayer('ictus-heat')
        if (map.current.getLayer('comarcas-interaction')) map.current.removeLayer('comarcas-interaction')
        if (map.current.getLayer('comarcas-line')) map.current.removeLayer('comarcas-line')
        if (map.current.getSource('comarcas')) map.current.removeSource('comarcas')
        if (map.current.getSource('data_ictus')) map.current.removeSource('data_ictus')
        map.current.off('mousemove', 'comarcas-interaction', handleMouseMove)
        map.current.off('mouseleave', 'comarcas-interaction', handleMouseLeave)
      }
    }
  }, [map]) // Solo se ejecuta al montar


  // --- EFECTO 2: ACTUALIZAR VISIBILIDAD (Cuando activeView cambie) ---
  useEffect(() => {
    if (!map.current) return;

    // Función para actualizar la propiedad de visibilidad en Mapbox
    const updateVisibility = () => {
      if (map.current.getLayer('ictus-heat')) {
        map.current.setLayoutProperty(
          'ictus-heat',
          'visibility',
          activeView === 'heatmap' ? 'visible' : 'none'
        );
        map.current.setLayoutProperty(
          'comarcas-interaction',
          'visibility',
          activeView === 'heatmap' ? 'visible' : 'none'
        );
      }
    };

    // Si el estilo ya cargó, actualizamos. Si no, esperamos a que cargue.
    if (map.current.isStyleLoaded()) {
      updateVisibility();
    } else {
      map.current.once('idle', updateVisibility);
    }

  }, [activeView, map]); // Este efecto escucha los cambios de activeView

  return null
}